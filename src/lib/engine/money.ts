// All money in the FMS is held as integer cents so totals are exact.

export type Cents = number;

export function toCents(kes: number | string): Cents {
  const n = typeof kes === 'string' ? Number(kes.replace(/,/g, '')) : kes;
  if (!Number.isFinite(n)) throw new Error(`Not a valid amount: ${kes}`);
  return Math.round(n * 100);
}

export function fromCents(c: Cents): number {
  return c / 100;
}

/** "12,067.46" — always two decimals, KES grouping. */
export function formatKES(c: Cents, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(c);
  const text = (abs / 100).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (c < 0) return `−${text}`;
  return opts.sign && c > 0 ? `+${text}` : text;
}

export interface Fraction {
  num: number;
  den: number;
}

export type Rounding = 'cent' | 'shilling';

/** amount × num / den, rounded toward zero to the cent or whole shilling. */
export function applyFraction(amount: Cents, f: Fraction, rounding: Rounding = 'cent'): Cents {
  if (f.den <= 0) throw new Error('Fraction denominator must be positive');
  const step = rounding === 'shilling' ? 100 : 1;
  const exact = (amount * f.num) / f.den;
  return Math.trunc(exact / step) * step;
}

/** Percentage of an amount, rounded to the nearest cent (RE). */
export function percentOf(amount: Cents, percent: number): Cents {
  return Math.round((amount * percent) / 100);
}

export function sum(values: Cents[]): Cents {
  return values.reduce((t, v) => t + v, 0);
}
