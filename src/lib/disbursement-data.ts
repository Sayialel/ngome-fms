import { DEFAULT_ONLINE_SETTINGS, DEFAULT_PHYSICAL_SETTINGS, type OnlineSettings, type PartnerCode, type PhysicalSettings } from '@/lib/engine/disbursement';
import type { Cents } from '@/lib/engine/money';
import type { NucData } from '@/lib/clients';
import { fetchInternal, type InternalData } from '@/lib/internal';
import { fetchNucData } from '@/lib/nuc';
import type { HeldOpen, RunAllocation } from '@/lib/run';
import { fetchSettings, type SettingRow } from '@/lib/settings';
import { supabase } from '@/lib/supabase';

export interface PartnerRow { id: string; code: PartnerCode; full_name: string; user_id: string | null }
export interface PartnerItem {
  id: string; partner_id: string; kind: 'drawing' | 'penalty' | 'contribution' | 'reimbursement' | 'debt' | 'repayment';
  label: string; amount_cents: Cents; item_date: string; due_date: string | null; pay_via: 'inr' | 'expense_account' | 'direct' | null;
  status: 'open' | 'applied' | 'settled'; debt_id: string | null; run_id: string | null; notes: string | null;
}
export interface RunRow {
  id: string; zone: 'online' | 'physical'; run_date: string; status: string; is_legacy: boolean; locked_at: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- snapshot JSON saved at lock time
  result: any; settings_snapshot: unknown; notes: string | null;
}

export interface RunData {
  internal: InternalData; nuc: NucData; settings: SettingRow[]; partners: PartnerRow[];
  items: PartnerItem[]; runs: RunRow[]; heldOpen: HeldOpen[]; unrun: RunAllocation[];
  clientName: Map<string, string>; invoiceRef: Map<string, string | null>; sessionDate: Map<string, string>;
}

export async function fetchRunData(): Promise<RunData> {
  const [internal, nuc, settings, partners, items, runs, held] = await Promise.all([
    fetchInternal(), fetchNucData(), fetchSettings(),
    supabase.from('partners').select('id, code, full_name, user_id').order('code'),
    supabase.from('partner_items').select('*').order('item_date', { ascending: false }),
    supabase.from('disbursement_runs').select('*').order('run_date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('held_sessions').select('id, allocation_id, client_id, session_date, amount_cents').is('released_in_run', null),
  ]);
  for (const r of [partners, items, runs, held]) if (r.error) throw r.error;
  const unrun: RunAllocation[] = nuc.allocations
    .filter((a) => a.confirmed && !a.is_legacy && a.run_id === null)
    .map((a) => ({ id: a.id, client_id: a.client_id, stream: a.stream, amount_cents: a.amount_cents, received_on: a.received_on, session_ids: a.session_ids ?? [], nuc_invoice_id: a.nuc_invoice_id }));
  return {
    internal, nuc, settings,
    partners: (partners.data ?? []) as PartnerRow[], items: (items.data ?? []) as PartnerItem[], runs: (runs.data ?? []) as RunRow[],
    heldOpen: (held.data ?? []) as HeldOpen[], unrun,
    clientName: new Map(nuc.clients.map((c) => [c.id, `${c.code} ${c.name}`])),
    invoiceRef: new Map(nuc.invoices.map((i) => [i.id, i.invoice_ref])),
    sessionDate: new Map(nuc.sessions.map((s) => [s.id, s.session_date])),
  };
}

/** The rules in force on a date. */
export function rulesOn(rows: SettingRow[], date: string): { online: OnlineSettings; physical: PhysicalSettings } {
  const get = <T,>(key: string, fallback: T): T => {
    const row = rows.filter((r) => r.key === key && r.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    return row ? (row.value as T) : fallback;
  };
  return {
    online: {
      rePercent: get('re_percent', DEFAULT_ONLINE_SETTINGS.rePercent),
      shares: get('partner_shares', DEFAULT_ONLINE_SETTINGS.shares),
      inrRounding: get('inr_rounding', DEFAULT_ONLINE_SETTINGS.inrRounding),
      targetClosingBalance: get('target_closing_balance_cents', DEFAULT_ONLINE_SETTINGS.targetClosingBalance),
    },
    physical: { ratio: get('physicals_ratio', DEFAULT_PHYSICAL_SETTINGS.ratio), payWithinDays: get('physicals_pay_within_days', DEFAULT_PHYSICAL_SETTINGS.payWithinDays) },
  };
}

/** What is still owed on each debt. */
export function debtBalances(items: PartnerItem[]) {
  return items
    .filter((i) => i.kind === 'debt')
    .map((d) => {
      const repaid = items.filter((r) => r.kind === 'repayment' && r.debt_id === d.id).reduce((t, r) => t + r.amount_cents, 0);
      return { debt: d, repaid, outstanding: Math.max(0, d.amount_cents - repaid) };
    });
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One line per movement between accounts: enough to rebuild a disbursement sheet. */
export function movementsCsv(d: InternalData, runs: RunRow[], from: string, to: string): string {
  const account = new Map(d.accounts.map((a) => [a.id, a.name]));
  const run = new Map(runs.map((r) => [r.id, `${r.zone} run ${r.run_date}`]));
  const legs = new Map<string, InternalData['entries']>();
  for (const e of d.entries) legs.set(e.transaction_id, [...(legs.get(e.transaction_id) ?? []), e]);
  const rows = d.transactions
    .filter((t) => t.txn_date >= from && t.txn_date <= to)
    .sort((a, b) => a.txn_date.localeCompare(b.txn_date) || a.created_at.localeCompare(b.created_at))
    .map((t) => {
      const l = legs.get(t.id) ?? [];
      const out = l.find((e) => e.amount_cents < 0);
      const inn = l.find((e) => e.amount_cents > 0);
      return [t.txn_date, t.kind, t.run_id ? (run.get(t.run_id) ?? '') : '', out ? (account.get(out.account_id) ?? '') : '', inn ? (account.get(inn.account_id) ?? '') : '',
        ((inn?.amount_cents ?? 0) / 100).toFixed(2), inn?.explanation ?? out?.explanation ?? t.description];
    });
  return [['Date', 'Type', 'Run', 'From account', 'To account', 'Amount (KES)', 'Explanation'], ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
