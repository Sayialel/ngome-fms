import { describe, expect, it } from 'vitest';
import { debtBalances, movementsCsv, type PartnerItem, type RunRow } from './disbursement-data';
import type { InternalData } from './internal';

describe('reports', () => {
  it('exports one CSV line per movement between accounts', () => {
    const d = {
      accounts: [{ id: 'rev', name: 'Revenue Account' }, { id: 'exp', name: 'Expense Account' }],
      transactions: [
        { id: 't1', txn_date: '2026-11-14', kind: 'disbursement', description: 'RE', run_id: 'r1', created_at: 'a' },
        { id: 't0', txn_date: '2026-10-01', kind: 'transfer', description: 'old', run_id: null, created_at: 'a' },
      ],
      entries: [
        { id: 'e1', transaction_id: 't1', account_id: 'rev', amount_cents: -757200, explanation: 'RE (10% of online entries)' },
        { id: 'e2', transaction_id: 't1', account_id: 'exp', amount_cents: 757200, explanation: 'RE (10% of online entries)' },
      ],
    } as unknown as InternalData;
    const csv = movementsCsv(d, [{ id: 'r1', zone: 'online', run_date: '2026-11-14' } as RunRow], '2026-11-01', '2026-11-30');
    expect(csv.split('\n')).toEqual([
      'Date,Type,Run,From account,To account,Amount (KES),Explanation',
      '2026-11-14,disbursement,online run 2026-11-14,Revenue Account,Expense Account,7572.00,RE (10% of online entries)',
    ]);
  });

  it('works out what is still owed on a debt', () => {
    const item = (o: Partial<PartnerItem>) => ({ id: 'x', partner_id: 'p', kind: 'debt', label: 'Loan', amount_cents: 2200000, item_date: '2026-11-01', due_date: null, pay_via: null, status: 'open', debt_id: null, run_id: null, notes: null, ...o }) as PartnerItem;
    const [d] = debtBalances([item({ id: 'd1' }), item({ id: 'r1', kind: 'repayment', amount_cents: 500000, debt_id: 'd1' })]);
    expect([d.repaid, d.outstanding]).toEqual([500000, 1700000]);
  });
});
