import { describe, expect, it } from 'vitest';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_PHYSICAL_SETTINGS } from './engine/disbursement';
import { buildOnlineRun, buildPhysicalRun, type RunAllocation } from './run';

const clientName = new Map([['k1', 'CA-0001 Pathfinders'], ['k2', 'CA-0006 Angela']]);
const invoiceRef = new Map<string, string | null>([['i1', 'PF/010/2026'], ['i2', 'AK/009/2026']]);
const sessionDate = new Map([['s1', '2026-11-05'], ['s2', '2026-11-12'], ['s3', '2026-11-19'], ['s4', '2026-11-26']]);
const alloc = (o: Partial<RunAllocation> & { id: string }): RunAllocation => ({ client_id: 'k1', stream: 'online', amount_cents: 0, received_on: '2026-11-13', session_ids: [], nuc_invoice_id: 'i1', ...o });

describe('building an online run', () => {
  // Pathfinders pay 16,000 for four sessions; two are after the 14 Nov run. Angela pays 10,440: 7,100 online + 3,340 physical.
  const allocations = [
    alloc({ id: 'a1', amount_cents: 1600000, session_ids: ['s1', 's2', 's3', 's4'] }),
    alloc({ id: 'a2', client_id: 'k2', amount_cents: 710000, nuc_invoice_id: 'i2' }),
    alloc({ id: 'a3', client_id: 'k2', stream: 'physical', amount_cents: 334000, nuc_invoice_id: 'i2' }),
    alloc({ id: 'a4', client_id: 'k2', stream: 'entrusted', amount_cents: 200000, nuc_invoice_id: 'i2' }),
  ];
  const run = buildOnlineRun({
    runDate: '2026-11-14', allocations, sessionDate, clientName, invoiceRef,
    heldOpen: [{ id: 'h1', allocation_id: 'old', client_id: 'k1', session_date: '2026-11-10', amount_cents: 300000 }, { id: 'h2', allocation_id: 'old', client_id: 'k1', session_date: '2026-11-20', amount_cents: 300000 }],
    manualReleases: [], revenueBalance: 2844002, // the four payments + 0.02 left from the last run
    deductions: [{ id: 'claude', label: 'Claude', amount: 310000, destination: 'subscriptions' }],
    adjustments: [{ id: 'd', partner: 'JMS', kind: 'debt_repayment', label: 'Loan', amount: 100000 }],
    settings: DEFAULT_ONLINE_SETTINGS,
  });

  it('holds money for sessions after the run date and releases sessions already held', () => {
    expect(run.heldTotal).toBe(800000);
    expect(run.held.map((h) => h.session_date)).toEqual(['2026-11-19', '2026-11-26']);
    expect(run.releasedTotal).toBe(300000);
    expect(run.releaseIds).toEqual(['h1']);
  });

  it('draws RE on online money and releases, not on the carried balance', () => {
    // entries: release 3,000 + Pathfinders 8,000 + Angela 7,100 + carried 0.02
    expect(run.result.totalEntries).toBe(1810002);
    expect(run.result.totalRE).toBe(181000);
    expect(run.result.pafd).toBe(1810002 - 181000 - 310000);
  });

  it('leaves physical money in Revenue and balances to the target', () => {
    expect(run.entrustedTotal).toBe(200000);
    expect(run.leftForLater).toBe(334000);
    expect(run.allocationIds).toEqual(['a1', 'a2', 'a4']);
    // Only the cents lost to rounding the three shares down remain unexplained.
    expect(run.difference).toBeGreaterThanOrEqual(0);
    expect(run.difference).toBeLessThan(3);
    expect(run.warnings).toEqual([]);
  });

  it('lists every transfer, with debt repayments going to the Expense Account', () => {
    const to = (code: string) => run.transfers.filter((t) => t.to === code).reduce((s, t) => s + t.amount_cents, 0);
    expect(to('holding')).toBe(800000 + 200000);
    expect(to('subscriptions')).toBe(310000);
    expect(to('expense')).toBe(181000 + 100000);
    expect(run.transfers.find((t) => t.kind === 'release')).toMatchObject({ from: 'holding', to: 'revenue', amount_cents: 300000 });
    const jms = run.result.partners.find((p) => p.partner === 'JMS')!;
    expect(jms.inr).toBe(jms.share - 100000);
    expect(to('partner_jms')).toBe(jms.inr);
  });
});

describe('building a physical run', () => {
  it('splits waiting physical money 2:1:1', () => {
    const run = buildPhysicalRun([alloc({ id: 'p1', stream: 'physical', amount_cents: 334000 }), alloc({ id: 'o1', amount_cents: 100 })], '2026-11-14', clientName, invoiceRef, DEFAULT_PHYSICAL_SETTINGS);
    expect(run.allocationIds).toEqual(['p1']);
    expect(run.transfers.map((t) => [t.to, t.amount_cents / 100])).toEqual([['partner_jms', 1670], ['partner_el', 835], ['partner_ew', 835]]);
  });
});
