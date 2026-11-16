// Pure calculations over NUC data for client accounts: invoice totals,
// statements and the per-student forecast. No I/O here.
import { toCents, type Cents } from '@/lib/engine/money';

export interface NucProfile { id: string; full_name: string | null; email: string | null; phone: string | null; roles: string[]; deleted_in_nuc: boolean }
export interface NucLink { parent_id: string; student_id: string }
export interface NucCohort { id: string; name: string; is_active: boolean | null }
export interface NucSession { id: string; cohort_id: string; session_date: string }
export interface NucEnrollment { student_id: string; cohort_id: string; status: string | null }
export interface InvoiceLine { id: string; kind: 'online' | 'physical' | 'other'; cohort_id: string | null; session_ids?: string[]; cohort_name?: string; dates?: string[]; students?: number; unit_price?: number; amount?: number }
export interface NucInvoice {
  id: string; student_id: string; cohort_id: string | null; particulars: string | null; invoice_ref: string | null;
  billing_date: string | null; amount: number | string; status: string | null; paid_at: string | null;
  document: { lines?: InvoiceLine[] } | null;
}
export interface NucInvoiceParent { invoice_id: string; parent_id: string }
export interface NucPayment { id: string; invoice_id: string; amount: number | string; paid_on: string | null; method: string | null; reference: string | null }
export type Stream = 'online' | 'physical' | 'entrusted' | 'credit';
export interface Allocation { id: string; nuc_payment_id: string | null; nuc_invoice_id: string | null; client_id: string; stream: Stream; amount_cents: number; received_on: string; run_id: string | null; transaction_id: string | null; is_legacy: boolean; session_ids?: string[]; confirmed?: boolean }
export interface Client { id: string; code: string; name: string; kind: 'family' | 'organisation'; notes: string | null; active: boolean }
export interface ClientMember { id: string; client_id: string; nuc_profile_id: string; role: 'parent' | 'student' | 'contact' }
export interface EnrolmentRate { nuc_student_id: string; nuc_cohort_id: string; rate_cents: number; effective_from: string }

export interface NucData {
  profiles: NucProfile[]; links: NucLink[]; cohorts: NucCohort[]; sessions: NucSession[]; enrollments: NucEnrollment[];
  invoices: NucInvoice[]; invoiceParents: NucInvoiceParent[]; payments: NucPayment[];
  clients: Client[]; members: ClientMember[]; rates: EnrolmentRate[]; allocations: Allocation[];
  /** Money in the Holding Account for sessions that have not happened yet. */
  held: { client_id: string; amount_cents: number; session_date: string }[];
}

export interface InvoiceSummary {
  id: string; ref: string | null; billingDate: string | null; studentId: string; student: string; parents: string[];
  cohort: string | null; particulars: string | null; amount: Cents; paid: Cents; balance: Cents;
  status: 'paid' | 'part_paid' | 'unpaid'; paidWithoutRecord: boolean; hasLines: boolean; clientId: string | null;
}

const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

/** Which client each student belongs to. */
export function studentClientMap(members: ClientMember[]) {
  return new Map(members.filter((m) => m.role === 'student').map((m) => [m.nuc_profile_id, m.client_id]));
}

export function summariseInvoices(d: NucData): InvoiceSummary[] {
  const profile = byId(d.profiles);
  const cohort = byId(d.cohorts);
  const clientOf = studentClientMap(d.members);
  const parents = new Map<string, string[]>();
  for (const l of d.invoiceParents) {
    parents.set(l.invoice_id, [...(parents.get(l.invoice_id) ?? []), profile.get(l.parent_id)?.full_name ?? 'Unknown parent']);
  }
  const recordedOf = new Map<string, Cents>();
  for (const p of d.payments) recordedOf.set(p.invoice_id, (recordedOf.get(p.invoice_id) ?? 0) + toCents(p.amount));

  return d.invoices.map((i) => {
    const amount = toCents(i.amount);
    const recorded = recordedOf.get(i.id) ?? 0;
    const markedPaid = i.status === 'paid';
    const paid = markedPaid ? Math.max(recorded, amount) : recorded;
    const balance = Math.max(0, amount - paid);
    return {
      id: i.id, ref: i.invoice_ref, billingDate: i.billing_date, studentId: i.student_id,
      student: profile.get(i.student_id)?.full_name ?? 'Unknown student',
      parents: parents.get(i.id) ?? [], cohort: i.cohort_id ? (cohort.get(i.cohort_id)?.name ?? null) : null,
      particulars: i.particulars, amount, paid, balance,
      status: balance === 0 ? 'paid' : paid > 0 ? 'part_paid' : 'unpaid',
      paidWithoutRecord: markedPaid && recorded < amount,
      hasLines: (i.document?.lines?.length ?? 0) > 0,
      clientId: clientOf.get(i.student_id) ?? null,
    };
  });
}

export interface ClientTotals { billed: Cents; paid: Cents; outstanding: Cents; invoices: number }

export function totalsByClient(invoices: InvoiceSummary[]) {
  const totals = new Map<string | null, ClientTotals>();
  for (const i of invoices) {
    const t = totals.get(i.clientId) ?? { billed: 0, paid: 0, outstanding: 0, invoices: 0 };
    t.billed += i.amount; t.paid += i.paid; t.outstanding += i.balance; t.invoices += 1;
    totals.set(i.clientId, t);
  }
  return totals;
}

// ---------------------------------------------------------------- statement

export interface StatementRow {
  date: string; kind: 'invoice' | 'payment'; description: string; student: string;
  charge: Cents; payment: Cents; /** Running amount owed to Ngome after this row (negative = client in credit). */ balance: Cents;
}

export function clientStatement(d: NucData, clientId: string): StatementRow[] {
  const clientOf = studentClientMap(d.members);
  const profile = byId(d.profiles);
  const invoices = d.invoices.filter((i) => clientOf.get(i.student_id) === clientId);
  const ids = new Set(invoices.map((i) => i.id));
  const recordedOf = new Map<string, Cents>();
  const rows: Omit<StatementRow, 'balance'>[] = [];

  for (const p of d.payments.filter((p) => ids.has(p.invoice_id))) {
    const inv = invoices.find((i) => i.id === p.invoice_id)!;
    const amount = toCents(p.amount);
    recordedOf.set(p.invoice_id, (recordedOf.get(p.invoice_id) ?? 0) + amount);
    rows.push({
      date: p.paid_on ?? inv.billing_date ?? '', kind: 'payment',
      description: `Payment for ${inv.invoice_ref ?? 'invoice'}${p.method ? ` · ${p.method}` : ''}${p.reference ? ` · ${p.reference}` : ''}`,
      student: profile.get(inv.student_id)?.full_name ?? '', charge: 0, payment: amount,
    });
  }
  for (const i of invoices) {
    const amount = toCents(i.amount);
    const student = profile.get(i.student_id)?.full_name ?? '';
    rows.push({ date: i.billing_date ?? '', kind: 'invoice', description: `Invoice ${i.invoice_ref ?? ''} — ${i.particulars ?? ''}`.trim(), student, charge: amount, payment: 0 });
    const gap = i.status === 'paid' ? amount - (recordedOf.get(i.id) ?? 0) : 0;
    if (gap > 0) {
      rows.push({
        date: (i.paid_at ?? i.billing_date ?? '').slice(0, 10), kind: 'payment',
        description: `Marked paid in the NUC for ${i.invoice_ref ?? 'invoice'} (no payment recorded)`, student, charge: 0, payment: gap,
      });
    }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));
  let balance = 0;
  return rows.map((r) => ({ ...r, balance: (balance += r.charge - r.payment) }));
}

// ---------------------------------------------------------------- forecast

export interface ForecastCell { month: string; sessions: number; expected: Cents | null; invoiced: Cents; paid: Cents; notInvoiced: Cents | null; outstanding: Cents }
export interface ForecastRow {
  studentId: string; student: string; cohortId: string; cohort: string;
  /** Rate per session in force; null when none is known yet. */
  rate: Cents | null; rateSource: 'set' | 'last_invoice' | null; cells: ForecastCell[];
}

export function monthsFrom(start: string, count: number): string[] {
  const [y, m] = start.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Invoiced amount per student + cohort + month, from line items (or the whole invoice when it has none). */
function invoicedPieces(inv: NucInvoice): { cohortId: string | null; month: string; amount: Cents }[] {
  const lines = inv.document?.lines ?? [];
  if (lines.length === 0) {
    return inv.billing_date ? [{ cohortId: inv.cohort_id, month: inv.billing_date.slice(0, 7), amount: toCents(inv.amount) }] : [];
  }
  const pieces: { cohortId: string | null; month: string; amount: Cents }[] = [];
  for (const l of lines) {
    const students = Math.max(1, Number(l.students) || 1);
    if (l.kind === 'other' || !l.dates?.length) {
      if (inv.billing_date) pieces.push({ cohortId: l.cohort_id, month: inv.billing_date.slice(0, 7), amount: toCents(l.amount ?? 0) });
      continue;
    }
    for (const date of l.dates) pieces.push({ cohortId: l.cohort_id, month: date.slice(0, 7), amount: toCents((l.unit_price ?? 0) * students) });
  }
  return pieces;
}

export function clientForecast(d: NucData, clientId: string, months: string[]): ForecastRow[] {
  return forecastForStudents(d, d.members.filter((m) => m.client_id === clientId && m.role === 'student').map((m) => m.nuc_profile_id), months);
}

export function forecastForStudents(d: NucData, students: string[], months: string[]): ForecastRow[] {
  const profile = byId(d.profiles);
  const cohort = byId(d.cohorts);
  const summaries = new Map(summariseInvoices(d).map((s) => [s.id, s]));
  const rows: ForecastRow[] = [];

  for (const studentId of students) {
    const invoices = d.invoices.filter((i) => i.student_id === studentId);
    const cohortIds = new Set<string>();
    for (const e of d.enrollments) {
      if (e.student_id === studentId && e.status === 'active' && cohort.get(e.cohort_id)?.is_active) cohortIds.add(e.cohort_id);
    }

    for (const cohortId of cohortIds) {
      const sessions = d.sessions.filter((s) => s.cohort_id === cohortId);
      const pieces = invoices.flatMap((inv) => {
        const s = summaries.get(inv.id)!;
        const paidShare = s.amount > 0 ? s.paid / s.amount : 0;
        return invoicedPieces(inv).filter((p) => p.cohortId === cohortId).map((p) => ({ ...p, paid: Math.round(p.amount * paidShare) }));
      });
      const hasActivity = sessions.some((s) => months.includes(s.session_date.slice(0, 7))) || pieces.some((p) => months.includes(p.month));
      if (!hasActivity) continue;

      // Rate: the latest one set in the FMS, otherwise the price on this student's most recent invoice line for the cohort.
      const set = d.rates
        .filter((r) => r.nuc_student_id === studentId && r.nuc_cohort_id === cohortId)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
      const lastLine = [...invoices]
        .sort((a, b) => (b.billing_date ?? '').localeCompare(a.billing_date ?? ''))
        .flatMap((i) => i.document?.lines ?? [])
        .find((l) => l.cohort_id === cohortId && l.kind === 'online' && l.unit_price);
      const rateFor = (month: string): Cents | null => {
        const inForce = set.find((r) => r.effective_from.slice(0, 7) <= month) ?? null;
        if (inForce) return inForce.rate_cents;
        return lastLine?.unit_price ? toCents(lastLine.unit_price) : null;
      };

      const cells = months.map((month): ForecastCell => {
        const count = sessions.filter((s) => s.session_date.slice(0, 7) === month).length;
        const rate = rateFor(month);
        const expected = rate === null ? null : count * rate;
        const invoiced = pieces.filter((p) => p.month === month).reduce((t, p) => t + p.amount, 0);
        const paid = pieces.filter((p) => p.month === month).reduce((t, p) => t + p.paid, 0);
        return { month, sessions: count, expected, invoiced, paid, notInvoiced: expected === null ? null : Math.max(0, expected - invoiced), outstanding: invoiced - paid };
      });
      const current = rateFor(months[0]);
      rows.push({
        studentId, student: profile.get(studentId)?.full_name ?? 'Unknown student', cohortId, cohort: cohort.get(cohortId)?.name ?? 'Unknown cohort',
        rate: current, rateSource: current === null ? null : set.some((r) => r.effective_from.slice(0, 7) <= months[0]) ? 'set' : 'last_invoice', cells,
      });
    }
  }
  return rows.sort((a, b) => a.student.localeCompare(b.student) || a.cohort.localeCompare(b.cohort));
}

// ---------------------------------------------------------------- payments to confirm

export interface Split { stream: Stream; amount_cents: Cents; line_id?: string; session_ids?: string[] }

export interface PaymentItem {
  /** Stable key: the NUC payment id, or "invoice:<id>" for an invoice marked paid with no payment recorded. */
  key: string; invoiceId: string; paymentId: string | null; ref: string | null; student: string;
  clientId: string | null; amount: Cents; date: string; method: string | null; reference: string | null;
  noRecord: boolean; hasLines: boolean; suggested: Split[];
  /** Set once confirmed in the FMS. */
  confirmed: {
    transactionId: string | null; splits: { stream: Stream; amount_cents: Cents }[]; inRun: boolean;
    /** Received before the FMS took over: already disbursed, so it never entered the Revenue Account here. */
    legacy: boolean; allocationIds: string[];
  } | null;
}

/** Split a payment across streams in proportion to the invoice's online and physical lines. */
export function suggestSplit(inv: NucInvoice, amount: Cents): Split[] {
  const lines = inv.document?.lines ?? [];
  const totals = { online: 0, physical: 0 };
  const sessions: string[] = [];
  for (const l of lines) {
    const students = Math.max(1, Number(l.students) || 1);
    const value = l.kind === 'other' ? toCents(l.amount ?? 0) : toCents((l.dates?.length ?? 0) * (l.unit_price ?? 0) * students);
    totals[l.kind === 'physical' ? 'physical' : 'online'] += value;
    if (l.kind === 'online') sessions.push(...(l.session_ids ?? []));
  }
  const whole = totals.online + totals.physical;
  if (whole === 0) return [{ stream: 'online', amount_cents: amount }];
  const physical = Math.round((amount * totals.physical) / whole);
  const splits: Split[] = [{ stream: 'online', amount_cents: amount - physical, session_ids: sessions }];
  if (physical > 0) splits.push({ stream: 'physical', amount_cents: physical });
  return splits.filter((s) => s.amount_cents > 0);
}

export function paymentItems(d: NucData): PaymentItem[] {
  const profile = byId(d.profiles);
  const clientOf = studentClientMap(d.members);
  const invoice = byId(d.invoices);
  const confirmedFor = (match: (a: Allocation) => boolean): PaymentItem['confirmed'] => {
    const rows = d.allocations.filter(match);
    if (rows.length === 0) return null;
    return { transactionId: rows[0].transaction_id, splits: rows.map((r) => ({ stream: r.stream, amount_cents: r.amount_cents })), inRun: rows.some((r) => r.run_id !== null), legacy: rows.some((r) => r.is_legacy), allocationIds: rows.map((r) => r.id) };
  };
  const base = (inv: NucInvoice) => ({
    invoiceId: inv.id, ref: inv.invoice_ref, student: profile.get(inv.student_id)?.full_name ?? 'Unknown student',
    clientId: clientOf.get(inv.student_id) ?? null, hasLines: (inv.document?.lines?.length ?? 0) > 0,
  });
  const items: PaymentItem[] = [];
  const recorded = new Map<string, Cents>();

  for (const p of d.payments) {
    const inv = invoice.get(p.invoice_id);
    if (!inv) continue;
    const amount = toCents(p.amount);
    recorded.set(inv.id, (recorded.get(inv.id) ?? 0) + amount);
    items.push({
      ...base(inv), key: p.id, paymentId: p.id, amount, date: p.paid_on ?? inv.billing_date ?? '', method: p.method, reference: p.reference,
      noRecord: false, suggested: suggestSplit(inv, amount), confirmed: confirmedFor((a) => a.nuc_payment_id === p.id),
    });
  }
  for (const inv of d.invoices) {
    const gap = inv.status === 'paid' ? toCents(inv.amount) - (recorded.get(inv.id) ?? 0) : 0;
    if (gap <= 0) continue;
    items.push({
      ...base(inv), key: `invoice:${inv.id}`, paymentId: null, amount: gap, date: (inv.paid_at ?? inv.billing_date ?? '').slice(0, 10), method: null, reference: null,
      noRecord: true, suggested: suggestSplit(inv, gap), confirmed: confirmedFor((a) => a.nuc_payment_id === null && a.nuc_invoice_id === inv.id),
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------- cohort view

export interface CohortRow { cohortId: string; cohort: string; students: number; missingRates: number; cells: { month: string; expected: Cents; invoiced: Cents; paid: Cents; outstanding: Cents }[] }

export function cohortSummary(d: NucData, months: string[]): CohortRow[] {
  const students = [...new Set(d.enrollments.filter((e) => e.status === 'active').map((e) => e.student_id))];
  const byCohort = new Map<string, ForecastRow[]>();
  for (const r of forecastForStudents(d, students, months)) byCohort.set(r.cohortId, [...(byCohort.get(r.cohortId) ?? []), r]);
  return [...byCohort.entries()]
    .map(([cohortId, rows]) => ({
      cohortId, cohort: rows[0].cohort, students: rows.length, missingRates: rows.filter((r) => r.rate === null).length,
      cells: months.map((month, i) => ({
        month,
        expected: rows.reduce((t, r) => t + (r.cells[i].expected ?? 0), 0),
        invoiced: rows.reduce((t, r) => t + r.cells[i].invoiced, 0),
        paid: rows.reduce((t, r) => t + r.cells[i].paid, 0),
        outstanding: rows.reduce((t, r) => t + r.cells[i].outstanding, 0),
      })),
    }))
    .sort((a, b) => a.cohort.localeCompare(b.cohort));
}
