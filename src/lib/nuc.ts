import { supabase } from '@/lib/supabase';
import { toCents, type Cents } from '@/lib/engine/money';

export interface InvoiceRow {
  id: string;
  ref: string | null;
  billingDate: string | null;
  student: string;
  parents: string[];
  cohort: string | null;
  particulars: string | null;
  amount: Cents;
  paid: Cents;
  balance: Cents;
  status: 'paid' | 'part_paid' | 'unpaid';
  /** Marked paid in the NUC with no payment recorded against it. */
  paidWithoutRecord: boolean;
  /** Has line items, so online and physical money can be told apart. */
  hasLines: boolean;
}

export interface SyncRun {
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
  counts: Record<string, number> | null;
}

export async function fetchLastSync(): Promise<SyncRun | null> {
  const { data, error } = await supabase
    .from('sync_runs')
    .select('started_at, finished_at, status, error, counts')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as SyncRun | null;
}

export async function syncNow() {
  const { data, error } = await supabase.rpc('sync_nuc');
  if (error) throw error;
  const result = data as { status: string; error?: string };
  if (result.status !== 'ok') throw new Error(result.error ?? 'Sync failed');
  return result;
}

export async function fetchInvoices(): Promise<InvoiceRow[]> {
  const [invoices, profiles, links, payments, cohorts] = await Promise.all([
    supabase.from('nuc_invoices').select('*').eq('deleted_in_nuc', false).order('billing_date', { ascending: false }),
    supabase.from('nuc_profiles').select('id, full_name'),
    supabase.from('nuc_invoice_parents').select('invoice_id, parent_id').eq('deleted_in_nuc', false),
    supabase.from('nuc_invoice_payments').select('invoice_id, amount').eq('deleted_in_nuc', false),
    supabase.from('nuc_cohorts').select('id, name'),
  ]);
  for (const r of [invoices, profiles, links, payments, cohorts]) if (r.error) throw r.error;

  const name = new Map((profiles.data ?? []).map((p) => [p.id as string, p.full_name as string]));
  const cohort = new Map((cohorts.data ?? []).map((c) => [c.id as string, c.name as string]));
  const parentsOf = new Map<string, string[]>();
  for (const l of links.data ?? []) {
    const list = parentsOf.get(l.invoice_id) ?? [];
    list.push(name.get(l.parent_id) ?? 'Unknown parent');
    parentsOf.set(l.invoice_id, list);
  }
  const paidOf = new Map<string, Cents>();
  for (const p of payments.data ?? []) paidOf.set(p.invoice_id, (paidOf.get(p.invoice_id) ?? 0) + toCents(p.amount));

  return (invoices.data ?? []).map((i) => {
    const amount = toCents(i.amount);
    const recorded = paidOf.get(i.id) ?? 0;
    const markedPaid = i.status === 'paid';
    const paid = markedPaid ? Math.max(recorded, amount) : recorded;
    const balance = Math.max(0, amount - paid);
    const lines = (i.document as { lines?: unknown[] } | null)?.lines;
    return {
      id: i.id,
      ref: i.invoice_ref,
      billingDate: i.billing_date,
      student: name.get(i.student_id) ?? 'Unknown student',
      parents: parentsOf.get(i.id) ?? [],
      cohort: i.cohort_id ? (cohort.get(i.cohort_id) ?? null) : null,
      particulars: i.particulars,
      amount,
      paid,
      balance,
      status: balance === 0 ? 'paid' : paid > 0 ? 'part_paid' : 'unpaid',
      paidWithoutRecord: markedPaid && recorded < amount,
      hasLines: Array.isArray(lines) && lines.length > 0,
    };
  });
}
