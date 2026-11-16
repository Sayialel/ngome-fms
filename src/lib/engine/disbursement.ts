// Online and physical disbursement calculations (Finance Memo NGG/ADMN/2026/002,
// as practised on the 11 Nov 2026 sheet). Pure functions: no I/O, integer cents.

import { applyFraction, percentOf, sum, type Cents, type Fraction, type Rounding } from './money';

export type PartnerCode = 'JMS' | 'EL' | 'EW';
export const PARTNERS: PartnerCode[] = ['JMS', 'EL', 'EW'];

/** Where money leaving the Revenue Account goes. */
export type Destination = 'expense' | 'subscriptions' | 'holding' | 'external';

export interface RunEntry {
  id: string;
  label: string;
  /** Gross amount received or released into this run. */
  amount: Cents;
  /** Part of the amount that is physical-session money (handled in the physical zone; no RE). */
  physical?: Cents;
  /** RE applies to client online money; not to a carried balance or other non-client lines. */
  reApplies: boolean;
}

export interface RunDeduction {
  id: string;
  label: string;
  amount: Cents;
  destination: Destination;
}

export type AdjustmentKind = 'penalty' | 'drawing' | 'contribution' | 'reimbursement' | 'debt_repayment';

export interface PartnerAdjustment {
  id: string;
  partner: PartnerCode;
  kind: AdjustmentKind;
  label: string;
  /** Always positive; the sign comes from the kind. */
  amount: Cents;
}

export interface OnlineSettings {
  rePercent: number;
  shares: Record<PartnerCode, Fraction>;
  inrRounding: Rounding;
  targetClosingBalance: Cents;
}

export interface OnlineRunInput {
  entries: RunEntry[];
  deductions: RunDeduction[];
  adjustments: PartnerAdjustment[];
  settings: OnlineSettings;
}

export interface EntryResult extends RunEntry {
  online: Cents;
  re: Cents;
}

export interface PartnerResult {
  partner: PartnerCode;
  share: Cents;
  adjustments: PartnerAdjustment[];
  adjustmentTotal: Cents;
  inr: Cents;
}

export interface Transfer {
  to: Destination | PartnerCode;
  amount: Cents;
  label: string;
}

export interface OnlineRunResult {
  entries: EntryResult[];
  totalEntries: Cents;
  totalPhysical: Cents;
  totalRE: Cents;
  totalDeductions: Cents;
  pafd: Cents;
  partners: PartnerResult[];
  tinr: Cents;
  closingBalance: Cents;
  /** closingBalance − target; non-zero means the run does not balance. */
  difference: Cents;
  transfers: Transfer[];
  warnings: string[];
}

const ADJUSTMENT_SIGN: Record<AdjustmentKind, 1 | -1> = {
  penalty: -1,
  drawing: -1,
  contribution: -1,
  debt_repayment: -1,
  reimbursement: 1,
};

export function signedAdjustment(a: PartnerAdjustment): Cents {
  return ADJUSTMENT_SIGN[a.kind] * a.amount;
}

export function validateShares(shares: Record<PartnerCode, Fraction>): string | null {
  // Sum of fractions must be exactly 1 (compare by cross-multiplying over a common denominator).
  const den = PARTNERS.reduce((d, p) => d * shares[p].den, 1);
  const num = PARTNERS.reduce((n, p) => n + shares[p].num * (den / shares[p].den), 0);
  return num === den ? null : 'Partner shares must add up to exactly 100%';
}

export function calculateOnlineRun(input: OnlineRunInput): OnlineRunResult {
  const { settings } = input;
  const warnings: string[] = [];

  const shareError = validateShares(settings.shares);
  if (shareError) warnings.push(shareError);

  const entries: EntryResult[] = input.entries.map((e) => {
    const physical = e.physical ?? 0;
    if (physical < 0 || physical > e.amount) warnings.push(`${e.label}: physical part must be between 0 and the amount`);
    const online = e.amount - physical;
    return { ...e, physical, online, re: e.reApplies ? percentOf(online, settings.rePercent) : 0 };
  });

  const totalEntries = sum(entries.map((e) => e.amount));
  const totalPhysical = sum(entries.map((e) => e.physical ?? 0));
  const totalRE = sum(entries.map((e) => e.re));
  const totalDeductions = sum(input.deductions.map((d) => d.amount));
  const pafd = totalEntries - totalPhysical - totalRE - totalDeductions;
  if (pafd < 0) warnings.push('PAFD is negative: deductions exceed the money available');

  const partners: PartnerResult[] = PARTNERS.map((partner) => {
    const share = applyFraction(pafd, settings.shares[partner], 'cent');
    const adjustments = input.adjustments.filter((a) => a.partner === partner);
    const adjustmentTotal = sum(adjustments.map(signedAdjustment));
    const inr = applyFraction(share + adjustmentTotal, { num: 1, den: 1 }, settings.inrRounding);
    return { partner, share, adjustments, adjustmentTotal, inr };
  });
  partners.forEach((p) => {
    if (p.inr < 0) warnings.push(`${p.partner}'s INR is negative`);
  });

  const tinr = sum(partners.map((p) => p.inr));
  const closingBalance = pafd - tinr;
  const difference = closingBalance - settings.targetClosingBalance;

  const transfers: Transfer[] = [];
  if (totalRE) transfers.push({ to: 'expense', amount: totalRE, label: `RE (${settings.rePercent}% of online entries)` });
  for (const d of input.deductions) transfers.push({ to: d.destination, amount: d.amount, label: d.label });
  for (const p of partners) if (p.inr) transfers.push({ to: p.partner, amount: p.inr, label: `${p.partner} INR` });

  return {
    entries,
    totalEntries,
    totalPhysical,
    totalRE,
    totalDeductions,
    pafd,
    partners,
    tinr,
    closingBalance,
    difference,
    transfers,
    warnings,
  };
}

// ---------------------------------------------------------------- physicals

export interface PhysicalEntry {
  id: string;
  label: string;
  amount: Cents;
  receivedOn: string; // ISO date
}

export interface PhysicalSettings {
  ratio: Record<PartnerCode, number>;
  payWithinDays: number;
}

export interface PhysicalRunResult {
  entries: (PhysicalEntry & { split: Record<PartnerCode, Cents>; dueBy: string })[];
  totals: Record<PartnerCode, Cents>;
  total: Cents;
  /** Cents lost to rounding down; stays in the Revenue Account. */
  remainder: Cents;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function calculatePhysicalRun(entries: PhysicalEntry[], settings: PhysicalSettings): PhysicalRunResult {
  const weight = sum(PARTNERS.map((p) => settings.ratio[p]));
  if (weight <= 0) throw new Error('Physicals ratio must be positive');

  const rows = entries.map((e) => {
    const split = Object.fromEntries(
      PARTNERS.map((p) => [p, applyFraction(e.amount, { num: settings.ratio[p], den: weight }, 'cent')]),
    ) as Record<PartnerCode, Cents>;
    return { ...e, split, dueBy: addDays(e.receivedOn, settings.payWithinDays) };
  });

  const totals = Object.fromEntries(PARTNERS.map((p) => [p, sum(rows.map((r) => r.split[p]))])) as Record<
    PartnerCode,
    Cents
  >;
  const total = sum(entries.map((e) => e.amount));
  return { entries: rows, totals, total, remainder: total - sum(PARTNERS.map((p) => totals[p])) };
}

export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = {
  rePercent: 10,
  shares: { JMS: { num: 13, den: 30 }, EL: { num: 17, den: 60 }, EW: { num: 17, den: 60 } },
  inrRounding: 'cent',
  targetClosingBalance: 0,
};

export const DEFAULT_PHYSICAL_SETTINGS: PhysicalSettings = {
  ratio: { JMS: 2, EL: 1, EW: 1 },
  payWithinDays: 7,
};
