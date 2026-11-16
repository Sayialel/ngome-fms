import { supabase } from '@/lib/supabase';
import type { NucData } from '@/lib/clients';

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

export async function fetchNucData(): Promise<NucData> {
  const live = (table: string, columns = '*') => supabase.from(table).select(columns).eq('deleted_in_nuc', false);
  const [profiles, links, cohorts, sessions, enrollments, invoices, invoiceParents, payments, clients, members, rates, allocations, held] = await Promise.all([
    supabase.from('nuc_profiles').select('*'),
    live('nuc_parent_student_links', 'parent_id, student_id'),
    live('nuc_cohorts', 'id, name, is_active'),
    live('nuc_sessions', 'id, cohort_id, session_date'),
    live('nuc_enrollments', 'student_id, cohort_id, status'),
    live('nuc_invoices').order('billing_date', { ascending: false }),
    live('nuc_invoice_parents', 'invoice_id, parent_id'),
    live('nuc_invoice_payments', 'id, invoice_id, amount, paid_on, method, reference'),
    supabase.from('clients').select('*').order('code'),
    supabase.from('client_members').select('*'),
    supabase.from('enrolment_rates').select('nuc_student_id, nuc_cohort_id, rate_cents, effective_from'),
    supabase.from('payment_allocations').select('id, nuc_payment_id, nuc_invoice_id, client_id, stream, amount_cents, received_on, run_id, transaction_id, is_legacy, session_ids, confirmed'),
    supabase.from('held_sessions').select('client_id, amount_cents, session_date').is('released_in_run', null),
  ]);
  const all = { profiles, links, cohorts, sessions, enrollments, invoices, invoiceParents, payments, clients, members, rates, allocations, held };
  for (const r of Object.values(all)) if (r.error) throw r.error;
  return Object.fromEntries(Object.entries(all).map(([k, r]) => [k, r.data ?? []])) as unknown as NucData;
}
