import { describe, expect, it } from 'vitest';
import { clientForecast, clientStatement, monthsFrom, summariseInvoices, totalsByClient, type NucData } from './clients';

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
});
