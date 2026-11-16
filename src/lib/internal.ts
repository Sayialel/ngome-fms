import { supabase } from '@/lib/supabase';
import type { Cents } from '@/lib/engine/money';

export interface Account { id: string; code: string; name: string; kind: 'bank' | 'partner' | 'external'; owner_partner_id: string | null; sort_order: number; balance_cents: Cents }
export interface Txn { id: string; txn_date: string; kind: string; description: string; run_id: string | null; created_at: string }
export interface Entry { id: string; transaction_id: string; account_id: string; amount_cents: Cents; explanation: string | null }
export interface Expense { id: string; item: string; amount_cents: Cents; spent_on: string; account_id: string; category: string | null; pre_agreed: boolean; receipt_path: string | null; notes: string | null; run_id: string | null; is_legacy: boolean }
export interface Recurring { id: string; name: string; amount_cents: Cents; frequency: 'monthly' | 'yearly' | 'occasional'; account_id: string; active: boolean; notes: string | null }
export interface Provision { id: string; label: string; estimated_cents: Cents; actual_cents: Cents | null; status: 'open' | 'settled'; funded: boolean; account_id: string | null; notes: string | null; run_id: string | null }
export interface Confirmation { id: string; account_id: string; as_of: string; actual_cents: Cents; system_cents: Cents; screenshot_path: string | null; note: string | null; confirmed_by: string | null; confirmed_at: string }

export interface InternalData {
  accounts: Account[]; transactions: Txn[]; entries: Entry[]; expenses: Expense[]; recurring: Recurring[];
  provisions: Provision[]; confirmations: Confirmation[]; partners: { id: string; code: string; user_id: string | null }[];
}

export async function fetchInternal(): Promise<InternalData> {
  const q = {
    accounts: supabase.from('account_balances').select('*').order('sort_order'),
    transactions: supabase.from('transactions').select('id, txn_date, kind, description, run_id, created_at'),
    entries: supabase.from('entries').select('id, transaction_id, account_id, amount_cents, explanation'),
    expenses: supabase.from('expenses').select('*').order('spent_on', { ascending: false }),
    recurring: supabase.from('recurring_expenses').select('*').order('name'),
    provisions: supabase.from('provisions').select('*').order('created_at', { ascending: false }),
    confirmations: supabase.from('balance_confirmations').select('*').order('confirmed_at', { ascending: false }),
    partners: supabase.from('partners').select('id, code, user_id'),
  };
  const keys = Object.keys(q) as (keyof typeof q)[];
  const results = await Promise.all(keys.map((k) => q[k]));
  const out: Record<string, unknown[]> = {};
  results.forEach((r, i) => {
    if (r.error) throw r.error;
    out[keys[i]] = r.data ?? [];
  });
  return out as unknown as InternalData;
}

export interface StatementLine { entryId: string; txnId: string; date: string; kind: string; description: string; explanation: string | null; other: string; amount: Cents; balance: Cents; locked: boolean }

/** Every movement on one account, oldest first, with the other side of each movement and a running balance. */
export function accountStatement(d: Pick<InternalData, 'accounts' | 'transactions' | 'entries'>, accountId: string): StatementLine[] {
  const txn = new Map(d.transactions.map((t) => [t.id, t]));
  const name = new Map(d.accounts.map((a) => [a.id, a.name]));
  const legs = new Map<string, Entry[]>();
  for (const e of d.entries) legs.set(e.transaction_id, [...(legs.get(e.transaction_id) ?? []), e]);

  const mine = d.entries
    .filter((e) => e.account_id === accountId && txn.has(e.transaction_id))
    .sort((a, b) => {
      const ta = txn.get(a.transaction_id)!, tb = txn.get(b.transaction_id)!;
      return ta.txn_date.localeCompare(tb.txn_date) || ta.created_at.localeCompare(tb.created_at);
    });
  let balance = 0;
  return mine.map((e) => {
    const t = txn.get(e.transaction_id)!;
    const others = [...new Set((legs.get(t.id) ?? []).filter((l) => l.account_id !== accountId).map((l) => name.get(l.account_id) ?? '—'))];
    balance += e.amount_cents;
    return { entryId: e.id, txnId: t.id, date: t.txn_date, kind: t.kind, description: t.description, explanation: e.explanation, other: others.join(', '), amount: e.amount_cents, balance, locked: t.run_id !== null };
  });
}

/** Monthly fixed costs per paying account, against what the account holds. */
export function monthlyForecast(d: Pick<InternalData, 'accounts' | 'recurring' | 'provisions'>) {
  return d.accounts
    .filter((a) => a.code === 'expense' || a.code === 'subscriptions')
    .map((a) => {
      const fixed = d.recurring.filter((r) => r.active && r.frequency === 'monthly' && r.account_id === a.id);
      const occasional = d.recurring.filter((r) => r.active && r.frequency !== 'monthly' && r.account_id === a.id);
      const provisions = d.provisions.filter((p) => p.status === 'open' && p.account_id === a.id);
      const fixedTotal = fixed.reduce((t, r) => t + r.amount_cents, 0);
      const provisionTotal = provisions.reduce((t, p) => t + p.estimated_cents, 0);
      const needed = fixedTotal + provisionTotal;
      return { account: a, fixed, occasional, provisions, fixedTotal, provisionTotal, needed, shortfall: Math.max(0, needed - a.balance_cents), free: a.balance_cents - needed };
    });
}

export async function uploadFinanceFile(folder: 'receipts' | 'balances', file: File): Promise<string> {
  const safe = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${folder}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from('finance-files').upload(path, file);
  if (error) throw error;
  return path;
}

export async function openFinanceFile(path: string) {
  const { data, error } = await supabase.storage.from('finance-files').createSignedUrl(path, 300);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}
