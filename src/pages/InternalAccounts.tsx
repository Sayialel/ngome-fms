import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Paperclip, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { formatKES, toCents } from '@/lib/engine/money';
import { accountStatement, fetchInternal, monthlyForecast, openFinanceFile, uploadFinanceFile, type Account, type InternalData, type Recurring } from '@/lib/internal';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const KIND: Record<string, string> = { opening: 'Opening', payment_in: 'Payment in', transfer: 'Transfer', expense: 'Expense', release: 'Release', disbursement: 'Disbursement', physical_payout: 'Physicals', partner_item: 'Partner', correction: 'Correction' };

function useSave<T>(fn: (v: T) => Promise<unknown>, done: string, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast.success(done);
      qc.invalidateQueries({ queryKey: ['internal'] });
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function AccountSelect({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="Choose an account" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TransferDialog({ data, onClose }: { data: InternalData; onClose: () => void }) {
  const banks = data.accounts.filter((a) => a.kind === 'bank');
  const [from, setFrom] = useState(banks.find((a) => a.code === 'revenue')?.id ?? '');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [why, setWhy] = useState('');
  const save = useSave(
    async () => {
      const { error } = await supabase.rpc('record_transfer', { p_from: from, p_to: to, p_amount_cents: toCents(amount), p_date: date, p_explanation: why });
      if (error) throw error;
    },
    'Transfer recorded',
    onClose,
  );
  const ok = from && to && from !== to && Number(amount) > 0 && date && why.trim();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer between accounts</DialogTitle>
          <DialogDescription>Shows as money leaving one account and arriving in the other, each with the explanation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="From">
            <AccountSelect accounts={banks} value={from} onChange={setFrom} />
          </Field>
          <Field label="To">
            <AccountSelect accounts={banks.filter((a) => a.id !== from)} value={to} onChange={setTo} />
          </Field>
          <Field label="Amount (KES)">
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="What is it for?">
            <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Top-up for instructor pay" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok || save.isPending} onClick={() => save.mutate(undefined)}>
            Record transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({ data, preset, onClose }: { data: InternalData; preset?: Recurring; onClose: () => void }) {
  const banks = data.accounts.filter((a) => a.kind === 'bank');
  const [item, setItem] = useState(preset?.name ?? '');
  const [amount, setAmount] = useState(preset ? String(preset.amount_cents / 100) : '');
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState(preset?.account_id ?? banks.find((a) => a.code === 'expense')?.id ?? '');
  const [category, setCategory] = useState(preset ? 'Recurring' : '');
  const [agreed, setAgreed] = useState(!!preset);
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const save = useSave(
    async () => {
      const receipt = file ? await uploadFinanceFile('receipts', file) : null;
      const { error } = await supabase.rpc('record_expense', {
        p_item: item, p_amount_cents: toCents(amount), p_date: date, p_account: account, p_category: category,
        p_pre_agreed: agreed, p_recurring_id: preset?.id ?? null, p_receipt_path: receipt, p_notes: notes,
      });
      if (error) throw error;
    },
    'Expense recorded',
    onClose,
  );
  const ok = item.trim() && Number(amount) > 0 && date && account;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>Takes the money out of the account it was paid from.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Expense">
            <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. Printing paper" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (KES)">
              <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Date spent">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Paid from">
            <AccountSelect accounts={banks} value={account} onChange={setAccount} />
          </Field>
          <Field label="Category (optional)">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Supplies, Events, Instructors" />
          </Field>
          <div className="flex items-center gap-3">
            <Switch id="agreed" checked={agreed} onCheckedChange={setAgreed} />
            <Label htmlFor="agreed">Pre-agreed by the partners</Label>
          </div>
          <Field label="Receipt (optional)">
            <Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Notes (optional)">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ok || save.isPending} onClick={() => save.mutate(undefined)}>
            {save.isPending ? 'Saving…' : 'Record expense'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Statement({ data, account }: { data: InternalData; account: Account }) {
  const lines = accountStatement(data, account.id).reverse();
  const undo = useSave(async (txnId: string) => {
    const { error } = await supabase.rpc('delete_transfer', { p_transaction_id: txnId });
    if (error) throw error;
  }, 'Transfer removed');
  if (lines.length === 0) return <p className="text-muted-foreground">No movements yet.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Explanation</TableHead>
            <TableHead>Other side</TableHead>
            <TableHead className="text-right">In / out</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((l) => (
            <TableRow key={l.entryId}>
              <TableCell className="tabular whitespace-nowrap">{l.date}</TableCell>
              <TableCell>{KIND[l.kind] ?? l.kind}</TableCell>
              <TableCell className="max-w-sm">{l.explanation ?? l.description}</TableCell>
              <TableCell className="text-muted-foreground">{l.other}</TableCell>
              <TableCell className={cn('tabular whitespace-nowrap text-right', l.amount < 0 ? 'text-negative' : 'text-positive')}>
                {formatKES(l.amount, { sign: true })}
              </TableCell>
              <TableCell className="tabular text-right font-medium">{formatKES(l.balance)}</TableCell>
              <TableCell className="text-right">
                {l.kind === 'transfer' && !l.locked && (
                  <Button variant="ghost" size="sm" aria-label="Remove transfer" disabled={undo.isPending} onClick={() => undo.mutate(l.txnId)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Expenses({ data, onAdd }: { data: InternalData; onAdd: (preset?: Recurring) => void }) {
  const name = new Map(data.accounts.map((a) => [a.id, a.name]));
  const remove = useSave(async (id: string) => {
    const { error } = await supabase.rpc('delete_expense', { p_id: id });
    if (error) throw error;
  }, 'Expense removed');
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Expenses can be removed and re-entered until a disbursement run has used them.</p>
        <Button size="sm" onClick={() => onAdd()}>
          <Plus className="mr-1 h-4 w-4" /> Record expense
        </Button>
      </div>
      {data.expenses.length === 0 ? (
        <p className="text-muted-foreground">No expenses recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Expense</TableHead>
                <TableHead>Paid from</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular whitespace-nowrap">{e.spent_on}</TableCell>
                  <TableCell>
                    {e.item} {e.category && <Badge variant="outline">{e.category}</Badge>} {!e.pre_agreed && <Badge variant="secondary">Not pre-agreed</Badge>}
                    {e.notes && <p className="text-sm text-muted-foreground">{e.notes}</p>}
                  </TableCell>
                  <TableCell>{name.get(e.account_id)}</TableCell>
                  <TableCell className="tabular text-right">{formatKES(e.amount_cents)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {e.receipt_path && (
                      <Button variant="ghost" size="sm" aria-label="Open receipt" onClick={() => openFinanceFile(e.receipt_path!).catch((x) => toast.error(x.message))}>
                        <Paperclip className="h-4 w-4" />
                      </Button>
                    )}
                    {e.run_id ? (
                      <Badge variant="secondary">In a run</Badge>
                    ) : (
                      <Button variant="ghost" size="sm" aria-label="Remove expense" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

function RecurringDialog({ data, row, onClose }: { data: InternalData; row: Recurring | null; onClose: () => void }) {
  const banks = data.accounts.filter((a) => a.kind === 'bank');
  const [name, setName] = useState(row?.name ?? '');
  const [amount, setAmount] = useState(row ? String(row.amount_cents / 100) : '');
  const [frequency, setFrequency] = useState<Recurring['frequency']>(row?.frequency ?? 'monthly');
  const [account, setAccount] = useState(row?.account_id ?? banks.find((a) => a.code === 'expense')?.id ?? '');
  const [active, setActive] = useState(row?.active ?? true);
  const save = useSave(
    async () => {
      const values = { name: name.trim(), amount_cents: toCents(amount), frequency, account_id: account, active };
      const { error } = row ? await supabase.from('recurring_expenses').update(values).eq('id', row.id) : await supabase.from('recurring_expenses').insert(values);
      if (error) throw error;
    },
    'Saved',
    onClose,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? 'Change recurring expense' : 'New recurring expense'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Amount (KES)">
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Frequency">
            <Select value={frequency} onValueChange={(v) => setFrequency(v as Recurring['frequency'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
                <SelectItem value="occasional">Occasional</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Paid from">
            <AccountSelect accounts={banks} value={account} onChange={setAccount} />
          </Field>
          <div className="flex items-center gap-3">
            <Switch id="active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="active">Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || amount === '' || Number(amount) < 0 || !account || save.isPending} onClick={() => save.mutate(undefined)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProvisionDialog({ data, onClose }: { data: InternalData; onClose: () => void }) {
  const banks = data.accounts.filter((a) => a.kind === 'bank');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState(banks.find((a) => a.code === 'expense')?.id ?? '');
  const save = useSave(
    async () => {
      const { error } = await supabase.from('provisions').insert({ label: label.trim(), estimated_cents: toCents(amount), account_id: account });
      if (error) throw error;
    },
    'Provision added',
    onClose,
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set money aside</DialogTitle>
          <DialogDescription>An estimate for a coming cost, such as an event. Settle it once the real cost is known.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="For">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Ngome Fun Day" />
          </Field>
          <Field label="Estimate (KES)">
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Held in">
            <AccountSelect accounts={banks} value={account} onChange={setAccount} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!label.trim() || !(Number(amount) > 0) || !account || save.isPending} onClick={() => save.mutate(undefined)}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Planning({ data, onPay }: { data: InternalData; onPay: (r: Recurring) => void }) {
  const [editing, setEditing] = useState<Recurring | null | 'new'>(null);
  const [adding, setAdding] = useState(false);
  const [settle, setSettle] = useState<Record<string, string>>({});
  const name = new Map(data.accounts.map((a) => [a.id, a.name]));
  const forecast = monthlyForecast(data);
  const settleSave = useSave(async (id: string) => {
    const { error } = await supabase.from('provisions').update({ status: 'settled', actual_cents: toCents(settle[id]) }).eq('id', id);
    if (error) throw error;
  }, 'Provision settled');

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-1 text-lg font-semibold">Next month’s forecast</h3>
        <p className="mb-3 text-sm text-muted-foreground">Fixed monthly costs and money set aside, against what each account holds now. A shortfall is drawn from the Revenue Account at the next disbursement.</p>
        <div className="grid gap-4 md:grid-cols-2">
          {forecast.map((f) => (
            <Card key={f.account.id}>
              <CardContent className="space-y-1 pt-6 text-sm">
                <p className="font-medium">{f.account.name}</p>
                <p className="tabular flex justify-between"><span>Balance now</span><span>{formatKES(f.account.balance_cents)}</span></p>
                {f.fixed.map((r) => (
                  <p key={r.id} className="tabular flex justify-between text-muted-foreground"><span>− {r.name} (monthly)</span><span>{formatKES(r.amount_cents)}</span></p>
                ))}
                {f.provisions.map((p) => (
                  <p key={p.id} className="tabular flex justify-between text-muted-foreground"><span>− {p.label} (set aside)</span><span>{formatKES(p.estimated_cents)}</span></p>
                ))}
                <p className={cn('tabular flex justify-between border-t pt-1 font-medium', f.shortfall > 0 && 'text-negative')}>
                  <span>{f.shortfall > 0 ? 'Shortfall' : 'Left after these'}</span>
                  <span>{formatKES(f.shortfall > 0 ? f.shortfall : f.free)}</span>
                </p>
                {f.occasional.length > 0 && <p className="text-xs text-muted-foreground">Not counted: {f.occasional.map((r) => `${r.name} ${formatKES(r.amount_cents)} (${r.frequency})`).join(', ')}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Fixed and recurring expenses</h3>
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}><Plus className="mr-1 h-4 w-4" /> Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Expense</TableHead><TableHead>Frequency</TableHead><TableHead>Paid from</TableHead><TableHead className="text-right">Amount</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.recurring.map((r) => (
              <TableRow key={r.id} className={cn(!r.active && 'opacity-50')}>
                <TableCell>{r.name} {!r.active && <Badge variant="secondary">Inactive</Badge>}</TableCell>
                <TableCell className="capitalize">{r.frequency}</TableCell>
                <TableCell>{name.get(r.account_id)}</TableCell>
                <TableCell className="tabular text-right">{formatKES(r.amount_cents)}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Change</Button>
                  {r.active && <Button variant="outline" size="sm" onClick={() => onPay(r)}>Record payment</Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Money set aside</h3>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="mr-1 h-4 w-4" /> Add</Button>
        </div>
        {data.provisions.length === 0 ? (
          <p className="text-muted-foreground">Nothing set aside.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>For</TableHead><TableHead>Held in</TableHead><TableHead className="text-right">Estimate</TableHead><TableHead className="text-right">Actual</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.provisions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.label}{p.notes && <p className="text-sm text-muted-foreground">{p.notes}</p>}</TableCell>
                  <TableCell>{p.account_id ? name.get(p.account_id) : '—'}</TableCell>
                  <TableCell className="tabular text-right">{formatKES(p.estimated_cents)}</TableCell>
                  <TableCell className="tabular text-right">{p.actual_cents === null ? '—' : formatKES(p.actual_cents)}</TableCell>
                  <TableCell className="text-right">
                    {p.status === 'settled' ? (
                      <Badge variant="secondary">Settled{p.actual_cents !== null && p.actual_cents !== p.estimated_cents ? ` · ${formatKES(p.estimated_cents - p.actual_cents, { sign: true })} vs estimate` : ''}</Badge>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <Input className="h-8 w-28" type="number" min="0" placeholder="Actual" aria-label={`Actual cost of ${p.label}`} value={settle[p.id] ?? ''} onChange={(e) => setSettle({ ...settle, [p.id]: e.target.value })} />
                        <Button size="sm" variant="outline" disabled={!settle[p.id] || settleSave.isPending} onClick={() => settleSave.mutate(p.id)}>Settle</Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="mt-2 text-sm text-muted-foreground">Settling records the real cost against the estimate. Record the spending itself under Expenses.</p>
      </section>

      {editing && <RecurringDialog data={data} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {adding && <ProvisionDialog data={data} onClose={() => setAdding(false)} />}
    </div>
  );
}

function BalanceCheck({ data }: { data: InternalData }) {
  const banks = data.accounts.filter((a) => a.kind === 'bank');
  const who = new Map(data.partners.map((p) => [p.user_id, p.code]));
  const owner = new Map(data.partners.map((p) => [p.id, p.code]));
  const [actual, setActual] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const save = useSave(async (a: Account) => {
    const path = files[a.id] ? await uploadFinanceFile('balances', files[a.id]!) : null;
    const { error } = await supabase.from('balance_confirmations').insert({ account_id: a.id, as_of: today(), actual_cents: toCents(actual[a.id]), system_cents: a.balance_cents, screenshot_path: path });
    if (error) throw error;
    setActual((s) => ({ ...s, [a.id]: '' }));
  }, 'Balance recorded');

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">Each owner enters what their bank account actually shows. Any difference from the system’s figure is flagged.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead><TableHead className="text-right">System balance</TableHead><TableHead>Actual balance today</TableHead><TableHead>Last check</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {banks.map((a) => {
            const last = data.confirmations.find((c) => c.account_id === a.id);
            const diff = last ? last.actual_cents - last.system_cents : 0;
            return (
              <TableRow key={a.id} className="align-top">
                <TableCell>{a.name}<p className="text-sm text-muted-foreground">Owner: {owner.get(a.owner_partner_id ?? '') ?? '—'}</p></TableCell>
                <TableCell className="tabular text-right">{formatKES(a.balance_cents)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="w-32" type="number" step="0.01" placeholder="KES" aria-label={`Actual balance of ${a.name}`} value={actual[a.id] ?? ''} onChange={(e) => setActual({ ...actual, [a.id]: e.target.value })} />
                    <Input className="w-52" type="file" accept="image/*,application/pdf" aria-label={`Screenshot for ${a.name}`} onChange={(e) => setFiles({ ...files, [a.id]: e.target.files?.[0] ?? null })} />
                    <Button size="sm" disabled={!actual[a.id] || save.isPending} onClick={() => save.mutate(a)}>Record</Button>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {last ? (
                    <>
                      <p className="tabular">{last.as_of} · {who.get(last.confirmed_by) ?? '—'} · actual {formatKES(last.actual_cents)}</p>
                      <p className={cn('tabular', diff === 0 ? 'text-positive' : 'text-negative')}>{diff === 0 ? 'Matched the system' : `Differed by ${formatKES(diff, { sign: true })}`}</p>
                      {last.screenshot_path && <button className="underline underline-offset-2" onClick={() => openFinanceFile(last.screenshot_path!).catch((x) => toast.error(x.message))}>Screenshot</button>}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Never checked</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}

export default function InternalAccounts() {
  const { partner } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['internal'], queryFn: fetchInternal });
  const [selected, setSelected] = useState<string | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [expense, setExpense] = useState<{ preset?: Recurring } | null>(null);

  const banks = (data?.accounts ?? []).filter((a) => a.kind === 'bank');
  const owner = new Map((data?.partners ?? []).map((p) => [p.id, p.code]));
  const account = banks.find((a) => a.id === selected) ?? banks[0];

  return (
    <>
      <PageHeader
        title="Internal Accounts"
        description="Ngome's four accounts, the money moving between them, and expenses."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" disabled={!data} onClick={() => setTransfer(true)}><ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer</Button>
            <Button disabled={!data} onClick={() => setExpense({})}><Plus className="mr-1 h-4 w-4" /> Expense</Button>
          </div>
        }
      />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {banks.map((a) => (
          <button key={a.id} onClick={() => setSelected(a.id)} className="text-left">
            <Card className={cn('transition-shadow hover:shadow-md', account?.id === a.id && 'ring-2 ring-ring')}>
              <CardHeader className="pb-2"><p className="text-sm text-muted-foreground">{a.name} · {owner.get(a.owner_partner_id ?? '') ?? '—'}</p></CardHeader>
              <CardContent><p className="tabular text-2xl font-semibold">KES {formatKES(a.balance_cents)}</p></CardContent>
            </Card>
          </button>
        ))}
      </div>

      {data && account && (
        <Tabs defaultValue="statement">
          <TabsList>
            <TabsTrigger value="statement">Statement</TabsTrigger>
            <TabsTrigger value="expenses">Expenses ({data.expenses.length})</TabsTrigger>
            <TabsTrigger value="planning">Recurring &amp; forecast</TabsTrigger>
            <TabsTrigger value="check">Balance check</TabsTrigger>
          </TabsList>
          <TabsContent value="statement">
            <Card>
              <CardHeader><CardTitle className="text-xl">{account.name} — statement</CardTitle></CardHeader>
              <CardContent><Statement data={data} account={account} /></CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="expenses"><Card><CardContent className="pt-6"><Expenses data={data} onAdd={(preset) => setExpense({ preset })} /></CardContent></Card></TabsContent>
          <TabsContent value="planning"><Card><CardContent className="pt-6"><Planning data={data} onPay={(preset) => setExpense({ preset })} /></CardContent></Card></TabsContent>
          <TabsContent value="check"><Card><CardContent className="pt-6"><BalanceCheck data={data} /></CardContent></Card></TabsContent>
        </Tabs>
      )}
      {!partner?.is_lead && <p className="mt-4 text-sm text-muted-foreground">Opening balances are set by the finance lead.</p>}

      {transfer && data && <TransferDialog data={data} onClose={() => setTransfer(false)} />}
      {expense && data && <ExpenseDialog data={data} preset={expense.preset} onClose={() => setExpense(null)} />}
    </>
  );
}
