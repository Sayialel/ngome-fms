import { supabase } from '@/lib/supabase';
import { formatKES } from '@/lib/engine/money';
import { validateShares, type PartnerCode } from '@/lib/engine/disbursement';

export interface SettingRow {
  id: string;
  key: string;
  value: unknown;
  effective_from: string;
  note: string | null;
  created_at: string;
}

export type SettingKind = 'date' | 'percent' | 'shares' | 'ratio' | 'days' | 'day_of_month' | 'rounding' | 'kes' | 'run_days';

export interface SettingMeta {
  key: string;
  label: string;
  help: string;
  kind: SettingKind;
  group: 'Disbursement' | 'Billing';
}

export const SETTINGS: SettingMeta[] = [
  { key: 're_percent', label: 'Retained earnings (RE)', help: 'Share of each online client entry kept in the Expense Account. Not taken on physicals.', kind: 'percent', group: 'Disbursement' },
  { key: 'partner_shares', label: 'Partner shares of PAFD', help: 'Must add up to exactly 100%.', kind: 'shares', group: 'Disbursement' },
  { key: 'physicals_ratio', label: 'Physicals split', help: 'Ratio used to split physical-session money.', kind: 'ratio', group: 'Disbursement' },
  { key: 'physicals_pay_within_days', label: 'Physicals paid within', help: 'Days after the session.', kind: 'days', group: 'Disbursement' },
  { key: 'inr_rounding', label: 'INR rounding', help: 'Each partner’s INR is rounded down; the remainder stays in the Revenue Account.', kind: 'rounding', group: 'Disbursement' },
  { key: 'target_closing_balance_cents', label: 'Target closing balance', help: 'What should be left in the Revenue Account after an online run.', kind: 'kes', group: 'Disbursement' },
  { key: 'run_days', label: 'Disbursement days', help: 'Days of the month runs are due, e.g. 14 and month_end.', kind: 'run_days', group: 'Disbursement' },
  { key: 'cutover_date', label: 'FMS cut-over date', help: 'Payments received on or before this date were disbursed before the FMS started.', kind: 'date', group: 'Disbursement' },
  { key: 'payment_window_days', label: 'Payment window', help: 'Days a parent has to pay after an invoice is sent before a reminder.', kind: 'days', group: 'Billing' },
  { key: 'invoice_raise_day', label: 'Invoices raised on', help: 'Day of the month next month’s invoices are raised.', kind: 'day_of_month', group: 'Billing' },
];

export const PARTNER_CODES: PartnerCode[] = ['JMS', 'EL', 'EW'];

type Shares = Record<PartnerCode, { num: number; den: number }>;
type Ratio = Record<PartnerCode, number>;

function pct(num: number, den: number) {
  const v = (num / den) * 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
}

export function formatSetting(kind: SettingKind, value: unknown): string {
  switch (kind) {
    case 'date':
      return String(value);
    case 'percent':
      return `${value}%`;
    case 'shares': {
      const s = value as Shares;
      return PARTNER_CODES.map((p) => `${p} ${pct(s[p].num, s[p].den)} (${s[p].num}/${s[p].den})`).join(' · ');
    }
    case 'ratio': {
      const r = value as Ratio;
      return PARTNER_CODES.map((p) => r[p]).join(' : ') + ` (${PARTNER_CODES.join(' : ')})`;
    }
    case 'days':
      return `${value} days`;
    case 'day_of_month':
      return `the ${value}th`;
    case 'rounding':
      return value === 'shilling' ? 'Down to the whole shilling' : 'Down to the cent';
    case 'kes':
      return `KES ${formatKES(Number(value))}`;
    case 'run_days':
      return (value as string[]).map((d) => (d === 'month_end' ? 'month end' : `the ${d}th`)).join(' and ');
  }
}

/** Validate an edited value; returns an error message or null. */
export function validateSetting(kind: SettingKind, value: unknown): string | null {
  const isWhole = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
  switch (kind) {
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : 'Choose a date';
    case 'percent':
      return typeof value === 'number' && value >= 0 && value <= 100 ? null : 'Enter a percentage between 0 and 100';
    case 'shares': {
      const s = value as Shares;
      if (PARTNER_CODES.some((p) => !isWhole(s[p]?.num) || !isWhole(s[p]?.den) || s[p].den <= 0 || s[p].num < 0)) {
        return 'Each share needs whole numbers, with a denominator above 0';
      }
      return validateShares(s);
    }
    case 'ratio': {
      const r = value as Ratio;
      return PARTNER_CODES.every((p) => isWhole(r[p]) && r[p] >= 0) && PARTNER_CODES.some((p) => r[p] > 0)
        ? null
        : 'Enter whole numbers, at least one above 0';
    }
    case 'days':
      return isWhole(value) && (value as number) >= 0 ? null : 'Enter a whole number of days';
    case 'day_of_month':
      return isWhole(value) && (value as number) >= 1 && (value as number) <= 28 ? null : 'Enter a day between 1 and 28';
    case 'rounding':
      return value === 'cent' || value === 'shilling' ? null : 'Choose a rounding rule';
    case 'kes':
      return isWhole(value) ? null : 'Enter an amount';
    case 'run_days': {
      const d = value as string[];
      return Array.isArray(d) && d.length > 0 && d.every((x) => x === 'month_end' || (/^\d+$/.test(x) && +x >= 1 && +x <= 28))
        ? null
        : 'Use day numbers 1–28 or month_end, separated by commas';
    }
  }
}

export async function fetchSettings(): Promise<SettingRow[]> {
  const { data, error } = await supabase.from('settings').select('*').order('effective_from', { ascending: false });
  if (error) throw error;
  return data as SettingRow[];
}

/** The row in force on a date for each key, plus its history. */
export function groupSettings(rows: SettingRow[], onDate: string) {
  const byKey = new Map<string, { current: SettingRow | null; scheduled: SettingRow[]; history: SettingRow[] }>();
  for (const meta of SETTINGS) byKey.set(meta.key, { current: null, scheduled: [], history: [] });
  for (const row of rows) {
    const g = byKey.get(row.key);
    if (!g) continue;
    if (row.effective_from > onDate) g.scheduled.push(row);
    else if (!g.current) g.current = row;
    else g.history.push(row);
  }
  return byKey;
}
