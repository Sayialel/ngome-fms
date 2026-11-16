import { describe, expect, it } from 'vitest';
import { accountStatement, monthlyForecast, type InternalData } from './internal';

const acc = (id: string, code: string, balance_cents: number) => ({ id, code, name: code, kind: 'bank' as const, owner_partner_id: null, sort_order: 0, balance_cents });
const d: Pick<InternalData, 'accounts' | 'transactions' | 'entries' | 'recurring' | 'provisions'> = {
  accounts: [acc('rev', 'revenue', 0), acc('exp', 'expense', 7403800), acc('sub', 'subscriptions', 364000)],
  transactions: [
    { id: 't1', txn_date: '2026-11-11', kind: 'opening', description: 'Opening', run_id: null, created_at: '2026-11-11T00:00:00Z' },
    { id: 't2', txn_date: '2026-11-12', kind: 'transfer', description: 'Revenue → Expense: top-up', run_id: null, created_at: '2026-11-12T00:00:00Z' },
  ],
  entries: [
    { id: 'e1', transaction_id: 't1', account_id: 'exp', amount_cents: 7403800, explanation: 'Opening balance' },
    { id: 'e2', transaction_id: 't2', account_id: 'rev', amount_cents: -100000, explanation: 'top-up' },
    { id: 'e3', transaction_id: 't2', account_id: 'exp', amount_cents: 100000, explanation: 'top-up' },
  ],
  recurring: [
    { id: 'r1', name: 'Claude', amount_cents: 310000, frequency: 'monthly', account_id: 'sub', active: true, notes: null },
    { id: 'r2', name: 'Instructors', amount_cents: 600000, frequency: 'monthly', account_id: 'exp', active: true, notes: null },
    { id: 'r3', name: 'Canva', amount_cents: 90000, frequency: 'occasional', account_id: 'sub', active: true, notes: null },
  ],
  provisions: [{ id: 'p1', label: 'Fun Day', estimated_cents: 3000000, actual_cents: null, status: 'open', funded: true, account_id: 'exp', notes: null, run_id: null }],
};

describe('internal accounts', () => {
  it('shows −1,000 leaving Revenue and +1,000 arriving in Expense with a running balance', () => {
    expect(accountStatement(d, 'rev').map((l) => [l.amount / 100, l.other, l.balance / 100])).toEqual([[-1000, 'expense', -1000]]);
    expect(accountStatement(d, 'exp').map((l) => [l.amount / 100, l.balance / 100])).toEqual([[74038, 74038], [1000, 75038]]);
  });

  it('forecasts next month against each account', () => {
    const f = monthlyForecast(d);
    const exp = f.find((x) => x.account.code === 'expense')!;
    expect([exp.fixedTotal, exp.provisionTotal, exp.shortfall, exp.free].map((c) => c / 100)).toEqual([6000, 30000, 0, 38038]);
    const sub = f.find((x) => x.account.code === 'subscriptions')!;
    expect([sub.fixedTotal, sub.free].map((c) => c / 100)).toEqual([3100, 540]);
  });
});
