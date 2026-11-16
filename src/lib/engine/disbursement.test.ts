import { describe, expect, it } from 'vitest';
import {
  calculateOnlineRun,
  calculatePhysicalRun,
  DEFAULT_ONLINE_SETTINGS,
  DEFAULT_PHYSICAL_SETTINGS,
  validateShares,
  type RunEntry,
} from './disbursement';
import { toCents as c } from './money';

const entry = (label: string, kes: number, extra: Partial<RunEntry> = {}): RunEntry => ({
  id: label,
  label,
  amount: c(kes),
  reApplies: true,
  ...extra,
});

describe('11 Nov 2026 disbursement sheet', () => {
  const result = calculateOnlineRun({
    entries: [
      entry('Mama Imani', 4000),
      entry('Mama Kimberly', 10440, { physical: c(3340) }),
      entry('Mama Gacau (Sept)', 7000),
      entry('Mama Gacau (Oct)', 7000),
      entry('Pathfinders', 23120),
      entry('Baba Matthew', 5500),
      entry('Mama Zia', 3000),
      entry('MWB 2nd half (released from Holding)', 16000),
      entry('Debate weeks 5, 6, 7 (Anaya + Andrew)', 3000),
    ],
    deductions: [
      { id: 'claude', label: 'Claude', amount: c(3100), destination: 'subscriptions' },
      { id: 'funday', label: 'Ngome Fun Day (estimate)', amount: c(30000), destination: 'expense' },
      { id: 'instructors', label: 'Instructors', amount: c(7200), destination: 'expense' },
    ],
    adjustments: [],
    settings: DEFAULT_ONLINE_SETTINGS,
  });

  it('totals the entries and draws RE on online money only', () => {
    expect(result.totalEntries).toBe(c(79060));
    expect(result.totalPhysical).toBe(c(3340));
    expect(result.entries.map((e) => e.re / 100)).toEqual([400, 710, 700, 700, 2312, 550, 300, 1600, 300]);
    expect(result.totalRE).toBe(c(7572));
  });

  it('reaches the same PAFD and INR', () => {
    expect(result.pafd).toBe(c(27848));
    const inr = Object.fromEntries(result.partners.map((p) => [p.partner, p.inr / 100]));
    expect(inr).toEqual({ JMS: 12067.46, EL: 7890.26, EW: 7890.26 });
    expect(result.closingBalance).toBe(2); // 0.02 left in Revenue by rounding down to the cent
    expect(result.warnings).toEqual([]);
  });

  it('lists the transfers out of the Revenue Account', () => {
    expect(result.transfers.map((t) => [t.to, t.amount / 100])).toEqual([
      ['expense', 7572],
      ['subscriptions', 3100],
      ['expense', 30000],
      ['expense', 7200],
      ['JMS', 12067.46],
      ['EL', 7890.26],
      ['EW', 7890.26],
    ]);
  });

  it('splits the physicals 2:1:1', () => {
    const phy = calculatePhysicalRun(
      [
        { id: 'a', label: 'Elevate A', amount: c(2000), receivedOn: '2026-11-05' },
        { id: 'b', label: 'JA B', amount: c(1340), receivedOn: '2026-11-05' },
      ],
      DEFAULT_PHYSICAL_SETTINGS,
    );
    expect(phy.totals).toEqual({ JMS: c(1670), EL: c(835), EW: c(835) });
    expect(phy.remainder).toBe(0);
    expect(phy.entries[0].dueBy).toBe('2026-11-12');
  });
});

describe('11 Nov 2026 side calculation (Mama Lulu, Mama Nia, carried balance)', () => {
  it('draws RE on the new entries but not on the carried balance', () => {
    const r = calculateOnlineRun({
      entries: [
        entry('Mama Lulu', 1500),
        entry('Mama Nia', 3000),
        entry('Balance carried forward', 2322, { reApplies: false }),
      ],
      deductions: [],
      adjustments: [],
      settings: DEFAULT_ONLINE_SETTINGS,
    });
    expect(r.totalRE).toBe(c(450));
    expect(r.pafd).toBe(c(6372));
    expect(r.partners.map((p) => p.inr / 100)).toEqual([2761.2, 1805.4, 1805.4]);
    expect(r.closingBalance).toBe(0);
  });
});

describe('11 Oct 2026 worked example (Finance Memo)', () => {
  it('reproduces PAFD 38,220.44 and TINR 39,220 with whole-shilling INR', () => {
    const r = calculateOnlineRun({
      // RE 4,505 is 10% of a 45,050 client base; the rest of the 72,985 ANR carries no RE.
      entries: [
        entry('Client entries (RE base)', 45050),
        entry('Other money in the Revenue Account', 27935, { reApplies: false }),
      ],
      deductions: [
        { id: 'phy', label: 'Physicals — Elevate B', amount: c(4050), destination: 'external' },
        { id: 'claude', label: 'Claude', amount: c(3109.56), destination: 'subscriptions' },
        { id: 'design', label: 'Design work', amount: c(7100), destination: 'expense' },
        { id: 'mwb', label: 'MWB 2nd half to Holding', amount: c(16000), destination: 'holding' },
      ],
      adjustments: [
        { id: 'p', partner: 'EL', kind: 'penalty', label: 'Penalty', amount: c(100) },
        { id: 'r', partner: 'EW', kind: 'reimbursement', label: 'Reimbursement', amount: c(1100) },
      ],
      settings: { ...DEFAULT_ONLINE_SETTINGS, inrRounding: 'shilling', targetClosingBalance: c(-1000) },
    });
    expect(r.totalRE).toBe(c(4505));
    expect(r.pafd).toBe(c(38220.44));
    expect(r.partners.map((p) => p.share / 100)).toEqual([16562.19, 10829.12, 10829.12]);
    expect(r.partners.map((p) => p.inr / 100)).toEqual([16562, 10729, 11929]);
    expect(r.tinr).toBe(c(39220));
  });
});

describe('settings checks', () => {
  it('rejects shares that do not add up to 100%', () => {
    expect(validateShares(DEFAULT_ONLINE_SETTINGS.shares)).toBeNull();
    expect(validateShares({ JMS: { num: 2, den: 5 }, EL: { num: 1, den: 4 }, EW: { num: 1, den: 4 } })).not.toBeNull();
  });

  it('warns when deductions exceed the money available', () => {
    const r = calculateOnlineRun({
      entries: [entry('Small', 1000)],
      deductions: [{ id: 'x', label: 'Big', amount: c(5000), destination: 'expense' }],
      adjustments: [],
      settings: DEFAULT_ONLINE_SETTINGS,
    });
    expect(r.warnings.some((w) => w.includes('PAFD is negative'))).toBe(true);
  });
});
