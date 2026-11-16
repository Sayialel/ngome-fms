import { describe, expect, it } from 'vitest';
import { clientForecast, clientStatement, cohortSummary, monthsFrom, paymentItems, suggestSplit, summariseInvoices, totalsByClient, type NucData } from './clients';

const data: NucData = {
  profiles: [
    { id: 'p1', full_name: 'Parent One', email: null, phone: null, roles: ['parent'], deleted_in_nuc: false },
    { id: 's1', full_name: 'Student One', email: null, phone: null, roles: ['student'], deleted_in_nuc: false },
  ],
  links: [{ parent_id: 'p1', student_id: 's1' }],
  cohorts: [{ id: 'c1', name: 'Cohort A', is_active: true }],
  sessions: [
    { id: 'x1', cohort_id: 'c1', session_date: '2026-11-03' },
    { id: 'x2', cohort_id: 'c1', session_date: '2026-11-10' },
    { id: 'x3', cohort_id: 'c1', session_date: '2026-11-17' },
    { id: 'x4', cohort_id: 'c1', session_date: '2026-11-24' },
    { id: 'x5', cohort_id: 'c1', session_date: '2026-12-01' },
  ],
  enrollments: [{ student_id: 's1', cohort_id: 'c1', status: 'active' }],
  invoices: [
    {
      id: 'i1', student_id: 's1', cohort_id: 'c1', particulars: 'Nov classes', invoice_ref: 'PO/001/2026', billing_date: '2026-11-14',
      amount: 1000, status: 'unpaid', paid_at: null,
      document: { lines: [{ id: 'l1', kind: 'online', cohort_id: 'c1', dates: ['2026-11-03', '2026-11-10'], students: 1, unit_price: 500 }] },
    },
    { id: 'i2', student_id: 's1', cohort_id: 'c1', particulars: 'Old bill', invoice_ref: '007', billing_date: '2026-10-11', amount: 1500, status: 'paid', paid_at: '2026-10-20T10:00:00Z', document: null },
  ],
  invoiceParents: [{ invoice_id: 'i1', parent_id: 'p1' }],
  payments: [{ id: 'pay1', invoice_id: 'i1', amount: 500, paid_on: '2026-11-15', method: 'M-Pesa', reference: 'ABC' }],
  clients: [{ id: 'k1', code: 'CA-0001', name: 'One family', kind: 'family', notes: null, active: true }],
  members: [
    { id: 'm1', client_id: 'k1', nuc_profile_id: 'p1', role: 'parent' },
    { id: 'm2', client_id: 'k1', nuc_profile_id: 's1', role: 'student' },
  ],
  rates: [],
  allocations: [],
};

describe('client accounts', () => {
  it('summarises invoices, counting NUC "marked paid" as paid', () => {
    const s = summariseInvoices(data);
    expect(s.find((i) => i.id === 'i1')).toMatchObject({ amount: 100000, paid: 50000, balance: 50000, status: 'part_paid', clientId: 'k1' });
    expect(s.find((i) => i.id === 'i2')).toMatchObject({ paid: 150000, balance: 0, status: 'paid', paidWithoutRecord: true });
    expect(totalsByClient(s).get('k1')).toEqual({ billed: 250000, paid: 200000, outstanding: 50000, invoices: 2 });
  });

  it('builds a statement with a running balance', () => {
    const rows = clientStatement(data, 'k1');
    expect(rows.map((r) => [r.date, r.kind, r.balance / 100])).toEqual([
      ['2026-10-11', 'invoice', 1500],
      ['2026-10-20', 'payment', 0],
      ['2026-11-14', 'invoice', 1000],
      ['2026-11-15', 'payment', 500],
    ]);
  });

  it('forecasts per student and cohort from sessions and the last invoiced rate', () => {
    const [row] = clientForecast(data, 'k1', monthsFrom('2026-11', 2));
    expect(row).toMatchObject({ student: 'Student One', cohort: 'Cohort A', rate: 50000, rateSource: 'last_invoice' });
    expect(row.cells[0]).toEqual({ month: '2026-11', sessions: 4, expected: 200000, invoiced: 100000, paid: 50000, notInvoiced: 100000, outstanding: 50000 });
    expect(row.cells[1]).toMatchObject({ month: '2026-12', sessions: 1, expected: 50000, invoiced: 0, notInvoiced: 50000 });
  });

  it('uses a rate set in the FMS from its effective month', () => {
    const d = { ...data, rates: [{ nuc_student_id: 's1', nuc_cohort_id: 'c1', rate_cents: 70000, effective_from: '2026-12-01' }] };
    const [row] = clientForecast(d, 'k1', monthsFrom('2026-11', 2));
    expect(row.cells.map((c) => c.expected)).toEqual([200000, 70000]);
  });

  it('rolls months over the year end', () => {
    expect(monthsFrom('2026-11', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });

  it('lists payments to confirm, including invoices marked paid with no payment recorded', () => {
    const items = paymentItems(data);
    expect(items.map((i) => [i.key, i.amount / 100, i.noRecord, i.confirmed])).toEqual([
      ['pay1', 500, false, null],
      ['invoice:i2', 1500, true, null],
    ]);
    const confirmed = paymentItems({
      ...data,
      allocations: [{ id: 'a1', nuc_payment_id: 'pay1', nuc_invoice_id: 'i1', client_id: 'k1', stream: 'online', amount_cents: 50000, received_on: '2026-11-15', run_id: null, transaction_id: 't1', is_legacy: false }],
    });
    expect(confirmed[0].confirmed).toEqual({ transactionId: 't1', splits: [{ stream: 'online', amount_cents: 50000 }], inRun: false, legacy: false, allocationIds: ['a1'] });
  });

  it('suggests an online / physical split from the invoice lines (Mama Kimberly: 10,440 = 7,100 + 3,340)', () => {
    const inv = {
      ...data.invoices[0],
      amount: 10440,
      document: {
        lines: [
          { id: 'a', kind: 'online' as const, cohort_id: 'c1', dates: ['2026-11-03', '2026-11-10'], students: 1, unit_price: 3550, session_ids: ['x1', 'x2'] },
          { id: 'b', kind: 'physical' as const, cohort_id: 'c1', dates: ['2026-11-07'], students: 1, unit_price: 3340 },
        ],
      },
    };
    expect(suggestSplit(inv, 1044000)).toEqual([
      { stream: 'online', amount_cents: 710000, session_ids: ['x1', 'x2'] },
      { stream: 'physical', amount_cents: 334000 },
    ]);
    expect(suggestSplit(data.invoices[1], 150000)).toEqual([{ stream: 'online', amount_cents: 150000 }]);
  });

  it('summarises by cohort', () => {
    const [row] = cohortSummary(data, monthsFrom('2026-11', 1));
    expect(row).toMatchObject({ cohort: 'Cohort A', students: 1, missingRates: 0 });
    expect(row.cells[0]).toEqual({ month: '2026-11', expected: 200000, invoiced: 100000, paid: 50000, outstanding: 50000 });
  });
});
