// Turns the FMS's records into a disbursement run: what enters, what is held,
// what is released, and the exact transfers to make. Pure; the engine does the sums.
import {
  calculateOnlineRun, calculatePhysicalRun, PARTNERS,
  type OnlineRunResult, type OnlineSettings, type PartnerAdjustment, type PartnerCode, type PhysicalRunResult, type PhysicalSettings, type RunDeduction, type RunEntry,
} from '@/lib/engine/disbursement';
import { sum, type Cents } from '@/lib/engine/money';

export interface RunAllocation { id: string; client_id: string; stream: 'online' | 'physical' | 'entrusted' | 'credit'; amount_cents: Cents; received_on: string; session_ids: string[]; nuc_invoice_id: string | null }
export interface HeldOpen { id: string; allocation_id: string; client_id: string; session_date: string; amount_cents: Cents }
export interface ManualRelease { id: string; label: string; amount: Cents }

export interface RunTransfer { from: string; to: string; amount_cents: Cents; explanation: string; kind: 'disbursement' | 'release' | 'physical_payout'; partner?: PartnerCode; client_id?: string }
export interface HeldRow { allocation_id: string; client_id: string; nuc_session_id: string; session_date: string; amount_cents: Cents }

export interface OnlineRunInput {
  runDate: string;
  /** Confirmed payments not yet used by a run (legacy ones excluded). */
  allocations: RunAllocation[];
  sessionDate: Map<string, string>;
  clientName: Map<string, string>;
  invoiceRef: Map<string, string | null>;
  heldOpen: HeldOpen[];
  manualReleases: ManualRelease[];
  /** Revenue Account balance in the ledger before the run. */
  revenueBalance: Cents;
  deductions: RunDeduction[];
  adjustments: PartnerAdjustment[];
  settings: OnlineSettings;
}

export interface OnlineRunBuild {
  result: OnlineRunResult;
  transfers: RunTransfer[];
  held: HeldRow[];
  allocationIds: string[];
  releaseIds: string[];
  heldTotal: Cents; releasedTotal: Cents; entrustedTotal: Cents;
  /** Physical money and payments dated after the run, left in Revenue for later. */
  leftForLater: Cents;
  revenueAfter: Cents;
  /** revenueAfter − leftForLater − target closing balance. Zero when the run balances. */
  difference: Cents;
  warnings: string[];
}

const partnerAccount = (p: PartnerCode) => `partner_${p.toLowerCase()}`;

export function buildOnlineRun(input: OnlineRunInput): OnlineRunBuild {
  const { runDate } = input;
  const name = (clientId: string) => input.clientName.get(clientId) ?? 'Unknown client';
  const due = input.allocations.filter((a) => a.received_on <= runDate);
  const entries: RunEntry[] = [];
  const held: HeldRow[] = [];
  const transfers: RunTransfer[] = [];
  const warnings: string[] = [];

  // Money released from Holding: sessions that have now happened.
  const releasable = input.heldOpen.filter((h) => h.session_date <= runDate);
  const byAllocation = new Map<string, HeldOpen[]>();
  for (const h of releasable) byAllocation.set(h.allocation_id, [...(byAllocation.get(h.allocation_id) ?? []), h]);
  for (const [allocationId, rows] of byAllocation) {
    const amount = sum(rows.map((r) => r.amount_cents));
    const label = `${name(rows[0].client_id)} · released from Holding (${rows.length} session${rows.length > 1 ? 's' : ''})`;
    entries.push({ id: `release:${allocationId}`, label, amount, reApplies: true });
    transfers.push({ from: 'holding', to: 'revenue', amount_cents: amount, explanation: label, kind: 'release', client_id: rows[0].client_id });
  }
  for (const m of input.manualReleases.filter((m) => m.amount > 0)) {
    entries.push({ id: `manual:${m.id}`, label: `${m.label} · released from Holding`, amount: m.amount, reApplies: true });
    transfers.push({ from: 'holding', to: 'revenue', amount_cents: m.amount, explanation: `${m.label} · released from Holding`, kind: 'release' });
  }
  const releasedTotal = sum(transfers.map((t) => t.amount_cents));

  // New online payments: sessions after the run date are held, the rest is distributable.
  const holdTransfers: RunTransfer[] = [];
  for (const a of due.filter((a) => a.stream === 'online' || a.stream === 'credit')) {
    const label = `${name(a.client_id)} · ${a.nuc_invoice_id ? (input.invoiceRef.get(a.nuc_invoice_id) ?? 'invoice') : 'payment'}`;
    const dated = a.session_ids.map((id) => ({ id, date: input.sessionDate.get(id) })).filter((s): s is { id: string; date: string } => !!s.date);
    const future = a.stream === 'credit' ? [] : dated.filter((s) => s.date > runDate);
    const per = dated.length ? Math.floor(a.amount_cents / dated.length) : 0;
    const allFuture = dated.length > 0 && future.length === dated.length;
    let heldAmount = 0;
    future.forEach((s, i) => {
      const amount = allFuture && i === future.length - 1 ? a.amount_cents - per * (future.length - 1) : per;
      heldAmount += amount;
      held.push({ allocation_id: a.id, client_id: a.client_id, nuc_session_id: s.id, session_date: s.date, amount_cents: amount });
    });
    if (heldAmount > 0) {
      holdTransfers.push({ from: 'revenue', to: 'holding', amount_cents: heldAmount, explanation: `${label} · held for ${future.length} session${future.length > 1 ? 's' : ''} after ${runDate}`, kind: 'disbursement', client_id: a.client_id });
    }
    if (a.amount_cents - heldAmount > 0) entries.push({ id: a.id, label, amount: a.amount_cents - heldAmount, reApplies: true });
  }
  for (const a of due.filter((a) => a.stream === 'entrusted')) {
    holdTransfers.push({ from: 'revenue', to: 'holding', amount_cents: a.amount_cents, explanation: `${name(a.client_id)} · entrusted money`, kind: 'disbursement', client_id: a.client_id });
  }
  const heldTotal = sum(held.map((h) => h.amount_cents));
  const entrustedTotal = sum(due.filter((a) => a.stream === 'entrusted').map((a) => a.amount_cents));

  // Anything else sitting in Revenue (e.g. a remainder from the last run) is carried in without RE.
  const unrunTotal = sum(input.allocations.map((a) => a.amount_cents));
  const carried = input.revenueBalance - unrunTotal;
  if (carried > 0) entries.push({ id: 'carried', label: 'Balance carried forward', amount: carried, reApplies: false });
  if (carried < 0) warnings.push('The Revenue Account holds less than the confirmed payments waiting to be disbursed. Check the account statement.');

  const result = calculateOnlineRun({ entries, deductions: input.deductions, adjustments: input.adjustments, settings: input.settings });

  for (const t of result.transfers) {
    const partner = PARTNERS.find((p) => p === t.to);
    transfers.push({
      from: 'revenue', to: partner ? partnerAccount(partner) : t.to === 'external' ? 'payees' : t.to,
      amount_cents: t.amount, explanation: t.label, kind: 'disbursement', ...(partner ? { partner } : {}),
    });
  }
  // Debt repayments taken from a share stay in Ngome: move them to the Expense Account.
  for (const a of input.adjustments.filter((a) => a.kind === 'debt_repayment' && a.amount > 0)) {
    transfers.push({ from: 'revenue', to: 'expense', amount_cents: a.amount, explanation: `${a.partner} debt repayment — ${a.label}`, kind: 'disbursement', partner: a.partner });
  }
  transfers.push(...holdTransfers);

  const out = sum(transfers.filter((t) => t.from === 'revenue').map((t) => t.amount_cents));
  const revenueAfter = input.revenueBalance + releasedTotal - out;
  const leftForLater =
    sum(due.filter((a) => a.stream === 'physical').map((a) => a.amount_cents)) +
    sum(input.allocations.filter((a) => a.received_on > runDate).map((a) => a.amount_cents));
  const difference = revenueAfter - leftForLater - input.settings.targetClosingBalance;
  if (revenueAfter < 0) warnings.push('This run pays out more than the Revenue Account holds.');

  return {
    result, transfers, held, heldTotal, releasedTotal, entrustedTotal, leftForLater, revenueAfter, difference,
    allocationIds: due.filter((a) => a.stream !== 'physical').map((a) => a.id),
    releaseIds: releasable.map((h) => h.id),
    warnings: [...warnings, ...result.warnings],
  };
}

export interface PhysicalRunBuild { result: PhysicalRunResult; transfers: RunTransfer[]; allocationIds: string[] }

export function buildPhysicalRun(allocations: RunAllocation[], runDate: string, clientName: Map<string, string>, invoiceRef: Map<string, string | null>, settings: PhysicalSettings): PhysicalRunBuild {
  const due = allocations.filter((a) => a.stream === 'physical' && a.received_on <= runDate);
  const result = calculatePhysicalRun(
    due.map((a) => ({ id: a.id, label: `${clientName.get(a.client_id) ?? 'Unknown client'} · ${a.nuc_invoice_id ? (invoiceRef.get(a.nuc_invoice_id) ?? 'invoice') : 'physical session'}`, amount: a.amount_cents, receivedOn: a.received_on })),
    settings,
  );
  const ratio = PARTNERS.map((p) => settings.ratio[p]).join(':');
  const transfers: RunTransfer[] = PARTNERS.filter((p) => result.totals[p] > 0).map((p) => ({
    from: 'revenue', to: partnerAccount(p), amount_cents: result.totals[p], explanation: `${p} physicals share (${ratio})`, kind: 'physical_payout', partner: p,
  }));
  return { result, transfers, allocationIds: due.map((a) => a.id) };
}
