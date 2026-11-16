import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { OnlineSheet } from '@/components/disbursement/RunSheet';
import SyncButton from '@/components/SyncButton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { paymentItems } from '@/lib/clients';
import { debtBalances, rulesOn, type RunData } from '@/lib/disbursement-data';
import type { Destination, PartnerAdjustment, RunDeduction } from '@/lib/engine/disbursement';
import { formatKES, toCents } from '@/lib/engine/money';
import { buildOnlineRun } from '@/lib/run';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
const DEST: Record<string, Destination> = { expense: 'expense', subscriptions: 'subscriptions', holding: 'holding' };
const uid = () => Math.random().toString(36).slice(2, 9);
const amountOf = (s: string) => (s === '' || Number.isNaN(Number(s)) || Number(s) < 0 ? 0 : toCents(s));

interface ManualLine { id: string; label: string; amount: string; destination: Destination }

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex-1">{children}</span>
    </label>
  );
}

export default function OnlineRun({ data }: { data: RunData }) {
  const qc = useQueryClient();
  const { partner } = useAuth();
  const [runDate, setRunDate] = useState(today());
  const month = runDate.slice(0, 7);
  const accountCode = useMemo(() => new Map(data.internal.accounts.map((a) => [a.id, a.code])), [data]);
  const partnerCode = useMemo(() => new Map(data.partners.map((p) => [p.id, p.code])), [data]);

  // Monthly costs are funded once a month: pre-ticked only if no online run this month has been locked yet.
  const fundedThisMonth = data.runs.some((r) => r.zone === 'online' && r.status === 'locked' && !r.is_legacy && r.run_date.slice(0, 7) === month);
  const recurring = data.internal.recurring.filter((r) => r.active);
  const provisions = data.internal.provisions.filter((p) => p.status === 'open' && !p.funded);
  const openItems = data.items.filter((i) => i.status === 'open' && (['penalty', 'drawing', 'contribution'].includes(i.kind) || (i.kind === 'reimbursement' && i.pay_via !== 'expense_account')));
  const debts = debtBalances(data.items).filter((d) => d.outstanding > 0);

  const [recurringOff, setRecurringOff] = useState<Record<string, boolean>>({});
  const [provisionOff, setProvisionOff] = useState<Record<string, boolean>>({});
  const [itemOff, setItemOff] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<ManualLine[]>([]);
  const [releases, setReleases] = useState<{ id: string; label: string; amount: string }[]>([]);
  const [repay, setRepay] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const recurringOn = (r: (typeof recurring)[number]) => !(recurringOff[r.id] ?? (r.frequency !== 'monthly' || fundedThisMonth));
  const rules = rulesOn(data.settings, runDate);

  const deductions: RunDeduction[] = [
    ...recurring.filter(recurringOn).map((r) => ({ id: `rec:${r.id}`, label: r.name, amount: r.amount_cents, destination: DEST[accountCode.get(r.account_id) ?? ''] ?? 'external' })),
    ...provisions.filter((p) => !provisionOff[p.id]).map((p) => ({ id: `prov:${p.id}`, label: `${p.label} (estimate)`, amount: p.estimated_cents, destination: DEST[accountCode.get(p.account_id ?? '') ?? ''] ?? ('expense' as Destination) })),
    ...manual.filter((m) => m.label.trim() && amountOf(m.amount) > 0).map((m) => ({ id: `man:${m.id}`, label: m.label.trim(), amount: amountOf(m.amount), destination: m.destination })),
  ];
  const adjustments: PartnerAdjustment[] = [
    ...openItems.filter((i) => !itemOff[i.id]).map((i) => ({ id: i.id, partner: partnerCode.get(i.partner_id)!, kind: i.kind as PartnerAdjustment['kind'], label: i.label, amount: i.amount_cents })),
    ...debts.filter((d) => amountOf(repay[d.debt.id] ?? '') > 0).map((d) => ({ id: `debt:${d.debt.id}`, partner: partnerCode.get(d.debt.partner_id)!, kind: 'debt_repayment' as const, label: d.debt.label, amount: Math.min(amountOf(repay[d.debt.id]), d.outstanding) })),
  ];

  const revenue = data.internal.accounts.find((a) => a.code === 'revenue')!;
  const holding = data.internal.accounts.find((a) => a.code === 'holding')!;
  const build = buildOnlineRun({
    runDate, allocations: data.unrun, sessionDate: data.sessionDate, clientName: data.clientName, invoiceRef: data.invoiceRef,
    heldOpen: data.heldOpen, manualReleases: releases.filter((r) => r.label.trim()).map((r) => ({ id: r.id, label: r.label.trim(), amount: amountOf(r.amount) })),
    revenueBalance: revenue.balance_cents, deductions, adjustments, settings: rules.online,
  });

  const pending = paymentItems(data.nuc).filter((i) => !i.confirmed && i.clientId);
  const releaseTotal = build.releasedTotal; // sessions released automatically + the manual releases above
  const autoReleased = releaseTotal - releases.filter((r) => r.label.trim()).reduce((t, r) => t + amountOf(r.amount), 0);
  const blockers = [
    ...(pending.length ? [`${pending.length} payment${pending.length > 1 ? 's' : ''} recorded in the NUC still to confirm (Client Accounts → Payments to confirm).`] : []),
    ...(build.result.entries.length === 0 ? ['Nothing has come in to disburse.'] : []),
    ...(releaseTotal > holding.balance_cents ? ['The releases are more than the Client Holding Account holds.'] : []),
    ...(build.revenueAfter < 0 ? ['This run pays out more than the Revenue Account holds.'] : []),
    ...(!partner?.is_lead ? ['Only the finance lead can lock a run.'] : []),
  ];
  const extras = { heldTotal: build.heldTotal, releasedTotal: releaseTotal, entrustedTotal: build.entrustedTotal, revenueAfter: build.revenueAfter, leftForLater: build.leftForLater, difference: build.difference, transfers: build.transfers, deductions };

  const lock = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('lock_run', {
        p_zone: 'online', p_run_date: runDate,
        p_payload: {
          transfers: build.transfers, allocation_ids: build.allocationIds, held: build.held, release_ids: build.releaseIds,
          partner_item_ids: adjustments.filter((a) => a.kind !== 'debt_repayment').map((a) => a.id),
          provision_ids: provisions.filter((p) => !provisionOff[p.id]).map((p) => p.id),
          repayments: adjustments.filter((a) => a.kind === 'debt_repayment').map((a) => ({ debt_id: a.id.replace('debt:', ''), amount_cents: a.amount })),
          settings: rules.online, result: { ...build.result, extras: { ...extras, revenueBefore: revenue.balance_cents } },
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Online run for ${runDate} locked`);
      setManual([]); setReleases([]); setRepay({});
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Label htmlFor="run-date">Run date</Label>
          <Input id="run-date" type="date" value={runDate} onChange={(e) => e.target.value && setRunDate(e.target.value)} className="w-44" />
        </div>
        <SyncButton />
      </div>
      <p className="text-sm text-muted-foreground">
        Sync first so nothing is missed. Revenue Account now: KES {formatKES(revenue.balance_cents)} · Client Holding: KES {formatKES(holding.balance_cents)} ·
        RE {rules.online.rePercent}%.
      </p>

      <div className="grid gap-6 lg:grid-cols-3">
        <section>
          <h4 className="mb-1 font-semibold">Deductions</h4>
          {recurring.map((r) => (
            <Check key={r.id} checked={recurringOn(r)} onChange={(v) => setRecurringOff({ ...recurringOff, [r.id]: !v })}>
              {r.name} <span className="tabular text-muted-foreground">· {formatKES(r.amount_cents)} · {r.frequency}</span>
            </Check>
          ))}
          {fundedThisMonth && <p className="text-xs text-muted-foreground">Monthly costs were funded in an earlier run this month, so they start unticked.</p>}
          {provisions.map((p) => (
            <Check key={p.id} checked={!provisionOff[p.id]} onChange={(v) => setProvisionOff({ ...provisionOff, [p.id]: !v })}>
              {p.label} <span className="tabular text-muted-foreground">· {formatKES(p.estimated_cents)} set aside</span>
            </Check>
          ))}
          {manual.map((m) => (
            <div key={m.id} className="mt-2 flex items-center gap-1">
              <Input aria-label="Deduction" placeholder="What for" value={m.label} onChange={(e) => setManual(manual.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label="Amount" className="w-24" type="number" min="0" placeholder="KES" value={m.amount} onChange={(e) => setManual(manual.map((x) => (x.id === m.id ? { ...x, amount: e.target.value } : x)))} />
              <Select value={m.destination} onValueChange={(v) => setManual(manual.map((x) => (x.id === m.id ? { ...x, destination: v as Destination } : x)))}>
                <SelectTrigger className="w-36" aria-label="Goes to"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="subscriptions">Subscriptions</SelectItem>
                  <SelectItem value="holding">Holding</SelectItem>
                  <SelectItem value="external">Paid out</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setManual(manual.filter((x) => x.id !== m.id))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setManual([...manual, { id: uid(), label: '', amount: '', destination: 'expense' }])}><Plus className="mr-1 h-4 w-4" /> Other deduction</Button>
        </section>

        <section>
          <h4 className="mb-1 font-semibold">Partner adjustments</h4>
          {openItems.length === 0 && debts.length === 0 && <p className="text-sm text-muted-foreground">No open penalties, drawings, contributions, reimbursements or debts. Add them under Partner accounts.</p>}
          {openItems.map((i) => (
            <Check key={i.id} checked={!itemOff[i.id]} onChange={(v) => setItemOff({ ...itemOff, [i.id]: !v })}>
              {partnerCode.get(i.partner_id)} · {i.kind} · {i.label} <span className="tabular text-muted-foreground">· {formatKES(i.amount_cents)}</span>
            </Check>
          ))}
          {debts.map((d) => (
            <div key={d.debt.id} className="mt-2 text-sm">
              <p>{partnerCode.get(d.debt.partner_id)} debt · {d.debt.label} <span className="tabular text-muted-foreground">· {formatKES(d.outstanding)} owed{d.debt.due_date ? ` · due ${d.debt.due_date}` : ''}</span></p>
              <Input aria-label={`Repayment from share for ${d.debt.label}`} className="mt-1 w-40" type="number" min="0" placeholder="Take from share" value={repay[d.debt.id] ?? ''} onChange={(e) => setRepay({ ...repay, [d.debt.id]: e.target.value })} />
            </div>
          ))}
        </section>

        <section>
          <h4 className="mb-1 font-semibold">Release from Holding</h4>
          <p className="text-sm text-muted-foreground">
            Sessions held by earlier runs release automatically once their date has passed ({formatKES(autoReleased)} now). Add older held money here,
            such as the opening balance, when its classes are done.
          </p>
          {releases.map((r) => (
            <div key={r.id} className="mt-2 flex items-center gap-1">
              <Input aria-label="Release for" placeholder="e.g. MWB 2nd half" value={r.label} onChange={(e) => setReleases(releases.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)))} />
              <Input aria-label="Amount" className="w-28" type="number" min="0" placeholder="KES" value={r.amount} onChange={(e) => setReleases(releases.map((x) => (x.id === r.id ? { ...x, amount: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setReleases(releases.filter((x) => x.id !== r.id))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setReleases([...releases, { id: uid(), label: '', amount: '' }])}><Plus className="mr-1 h-4 w-4" /> Release</Button>
        </section>
      </div>

      <div className="rounded-lg border p-4">
        <OnlineSheet result={build.result} extras={extras} />
      </div>

      {[...build.warnings.filter((w) => !blockers.includes(w)), ...blockers].map((w) => (
        <p key={w} className="text-sm text-negative">{w}</p>
      ))}
      <Button disabled={blockers.length > 0 || lock.isPending} onClick={() => setConfirming(true)}>
        <Lock className="mr-2 h-4 w-4" /> {lock.isPending ? 'Locking…' : 'Lock run'}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock the online run for {runDate}?</AlertDialogTitle>
            <AlertDialogDescription>
              This records {build.transfers.length} transfers, including KES {formatKES(build.result.tinr)} to the partners. A locked run cannot be edited; later changes go into the next run as corrections.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => lock.mutate()}>Lock run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
