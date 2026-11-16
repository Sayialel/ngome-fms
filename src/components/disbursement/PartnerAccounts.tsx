import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { debtBalances, type PartnerItem, type PartnerRow, type RunData } from '@/lib/disbursement-data';
import { formatKES, toCents } from '@/lib/engine/money';
import { supabase } from '@/lib/supabase';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const KINDS: { value: PartnerItem['kind']; label: string; help: string }[] = [
  { value: 'penalty', label: 'Penalty', help: 'Deducted from the next INR.' },
  { value: 'drawing', label: 'Drawing', help: 'Ngome money taken by the partner; deducted from the next INR.' },
  { value: 'contribution', label: 'Contribution', help: 'The partner’s share of a group contribution; deducted from the next INR.' },
  { value: 'reimbursement', label: 'Reimbursement', help: 'Money the partner spent for Ngome, to be returned.' },
  { value: 'debt', label: 'Debt', help: 'Owed to Ngome; stays on the account until repaid.' },
];
const KIND_LABEL: Record<string, string> = { ...Object.fromEntries(KINDS.map((k) => [k.value, k.label])), repayment: 'Repayment' };

function ItemDialog({ partner, onClose }: { partner: PartnerRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<PartnerItem['kind']>('penalty');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [due, setDue] = useState('');
  const [via, setVia] = useState<'inr' | 'expense_account'>('inr');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('partner_items').insert({
        partner_id: partner.id, kind, label: label.trim(), amount_cents: toCents(amount), item_date: date,
        due_date: kind === 'debt' && due ? due : null, pay_via: kind === 'reimbursement' ? via : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Added'); qc.invalidateQueries({ queryKey: ['run-data'] }); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to {partner.code}’s account</DialogTitle>
          <DialogDescription>{KINDS.find((k) => k.value === kind)!.help}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as PartnerItem['kind'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor="pi-label">What for</Label><Input id="pi-label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label htmlFor="pi-amount">Amount (KES)</Label><Input id="pi-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="pi-date">Date</Label><Input id="pi-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          {kind === 'debt' && <div className="space-y-1"><Label htmlFor="pi-due">Expected repayment date</Label><Input id="pi-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>}
          {kind === 'reimbursement' && (
            <div className="space-y-1">
              <Label>Returned through</Label>
              <Select value={via} onValueChange={(v) => setVia(v as typeof via)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inr">Added to the next INR</SelectItem>
                  <SelectItem value="expense_account">Paid from the Expense Account</SelectItem>
                </SelectContent>
              </Select>
              {via === 'expense_account' && <p className="text-xs text-muted-foreground">Record the payment itself as an expense under Internal Accounts, then mark this settled.</p>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!label.trim() || !(Number(amount) > 0) || !date || save.isPending} onClick={() => save.mutate()}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RepayDialog({ data, debt, outstanding, onClose }: { data: RunData; debt: PartnerItem; outstanding: number; onClose: () => void }) {
  const qc = useQueryClient();
  const banks = data.internal.accounts.filter((a) => a.kind === 'bank');
  const [amount, setAmount] = useState(String(outstanding / 100));
  const [date, setDate] = useState(today());
  const [account, setAccount] = useState(banks.find((a) => a.code === 'expense')?.id ?? '');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('record_partner_repayment', { p_debt_id: debt.id, p_amount_cents: toCents(amount), p_date: date, p_account: account });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Repayment recorded'); qc.invalidateQueries(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a repayment</DialogTitle>
          <DialogDescription>{debt.label} · KES {formatKES(outstanding)} still owed. Use this when the partner pays money in; to take it from their share, enter it in the online run.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label htmlFor="rp-amount">Amount (KES)</Label><Input id="rp-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="rp-date">Date</Label><Input id="rp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Paid into</Label>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{banks.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!(Number(amount) > 0) || toCents(amount || '0') > outstanding || !account || save.isPending} onClick={() => save.mutate()}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PartnerAccounts({ data }: { data: RunData }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<PartnerRow | null>(null);
  const [repaying, setRepaying] = useState<{ debt: PartnerItem; outstanding: number } | null>(null);
  const debts = debtBalances(data.items);
  const locked = data.runs.filter((r) => r.status === 'locked' && !r.is_legacy);
  const done = () => qc.invalidateQueries({ queryKey: ['run-data'] });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('partner_items').delete().eq('id', id); if (error) throw error; },
    onSuccess: done, onError: (e: Error) => toast.error(e.message),
  });
  const settle = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('partner_items').update({ status: 'settled' }).eq('id', id); if (error) throw error; },
    onSuccess: done, onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      {data.partners.map((p) => {
        const account = data.internal.accounts.find((a) => a.code === `partner_${p.code.toLowerCase()}`);
        const items = data.items.filter((i) => i.partner_id === p.id);
        const myDebts = debts.filter((d) => d.debt.partner_id === p.id);
        const owed = myDebts.reduce((t, d) => t + d.outstanding, 0);
        const history = locked
          .map((r) => {
            const amount: number = r.zone === 'online' ? (r.result?.partners?.find((x: { partner: string }) => x.partner === p.code)?.inr ?? 0) : (r.result?.totals?.[p.code] ?? 0);
            const share: number | null = r.zone === 'online' ? (r.result?.partners?.find((x: { partner: string }) => x.partner === p.code)?.share ?? null) : null;
            return { run: r, amount, share };
          });
        return (
          <Card key={p.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-xl">{p.code} · {p.full_name}</CardTitle>
                <p className="tabular mt-1 text-sm text-muted-foreground">
                  Paid out through the FMS: KES {formatKES(account?.balance_cents ?? 0)}
                  {owed > 0 && <span className="text-negative"> · owes Ngome KES {formatKES(owed)}</span>}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setAdding(p)}><Plus className="mr-1 h-4 w-4" /> Add item</Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <section>
                <h4 className="mb-2 font-semibold">Disbursement history</h4>
                {history.length === 0 ? <p className="text-sm text-muted-foreground">No runs locked yet.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Zone</TableHead><TableHead className="text-right">Share of PAFD</TableHead><TableHead className="text-right">Adjustments</TableHead><TableHead className="text-right">Paid</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {history.map(({ run, amount, share }) => (
                        <TableRow key={run.id}>
                          <TableCell className="tabular">{run.run_date}</TableCell>
                          <TableCell className="capitalize">{run.zone}</TableCell>
                          <TableCell className="tabular text-right">{share === null ? '—' : formatKES(share)}</TableCell>
                          <TableCell className="tabular text-right">{share === null || amount === share ? '—' : formatKES(amount - share, { sign: true })}</TableCell>
                          <TableCell className="tabular text-right font-medium">{formatKES(amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>

              {myDebts.length > 0 && (
                <section>
                  <h4 className="mb-2 font-semibold">Debts</h4>
                  <Table>
                    <TableHeader><TableRow><TableHead>Debt</TableHead><TableHead>Expected by</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">Repaid</TableHead><TableHead className="text-right">Still owed</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {myDebts.map(({ debt, repaid, outstanding }) => (
                        <TableRow key={debt.id}>
                          <TableCell>{debt.label}</TableCell>
                          <TableCell className="tabular">
                            {debt.due_date ?? '—'} {outstanding > 0 && debt.due_date && debt.due_date < today() && <Badge variant="destructive">Overdue</Badge>}
                          </TableCell>
                          <TableCell className="tabular text-right">{formatKES(debt.amount_cents)}</TableCell>
                          <TableCell className="tabular text-right">{formatKES(repaid)}</TableCell>
                          <TableCell className="tabular text-right font-medium">{formatKES(outstanding)}</TableCell>
                          <TableCell className="text-right">
                            {outstanding > 0 ? <Button size="sm" variant="outline" onClick={() => setRepaying({ debt, outstanding })}>Record repayment</Button> : <Badge variant="secondary">Repaid</Badge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </section>
              )}

              <section>
                <h4 className="mb-2 font-semibold">Items</h4>
                {items.length === 0 ? <p className="text-sm text-muted-foreground">No penalties, drawings, contributions, reimbursements or debts recorded.</p> : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>What for</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {items.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="tabular whitespace-nowrap">{i.item_date}</TableCell>
                          <TableCell>{KIND_LABEL[i.kind]}</TableCell>
                          <TableCell>{i.label}</TableCell>
                          <TableCell className="tabular text-right">{formatKES(i.amount_cents)}</TableCell>
                          <TableCell>
                            {i.status === 'open' ? <Badge>{i.kind === 'debt' ? 'Open' : i.pay_via === 'expense_account' ? 'To pay from Expense' : 'For next run'}</Badge>
                              : <Badge variant="secondary">{i.run_id ? `In run ${data.runs.find((r) => r.id === i.run_id)?.run_date ?? ''}` : 'Settled'}</Badge>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            {i.status === 'open' && i.kind === 'reimbursement' && i.pay_via === 'expense_account' && <Button size="sm" variant="ghost" onClick={() => settle.mutate(i.id)}>Mark settled</Button>}
                            {i.status === 'open' && !i.run_id && !data.items.some((r) => r.debt_id === i.id) && (
                              <Button size="sm" variant="ghost" aria-label={`Remove ${i.label}`} onClick={() => remove.mutate(i.id)}><Trash2 className="h-4 w-4" /></Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>
            </CardContent>
          </Card>
        );
      })}
      {adding && <ItemDialog partner={adding} onClose={() => setAdding(null)} />}
      {repaying && <RepayDialog data={data} debt={repaying.debt} outstanding={repaying.outstanding} onClose={() => setRepaying(null)} />}
    </div>
  );
}
