// Reads the CSV files exported from the Notion "Ngome Financial Tracker" and maps them
// to the FMS archive tables. Pure: parsing and matching only, no saving.
import { toCents } from '@/lib/engine/money';

export type Row = Record<string, string>;

/** RFC 4180 CSV: quoted fields, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // drop the byte-order mark
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** "October 11, 2026" or "25 Sept 26" → "2026-10-11". Takes the first date when several are listed. */
export function parseDate(text: string): string | null {
  const iso = (y: number, m: number, d: number) => `${y < 100 ? 2000 + y : y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  let m = text.match(/([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})/);
  if (m && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  m = text.match(/(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{2,4})/);
  if (m && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  return null;
}

const cents = (s: string) => (s && !Number.isNaN(Number(s.replace(/,/g, ''))) ? toCents(s) : null);
const clean = (s: string) => s.replace(/\s*\(https?:\/\/[^)]*\)/g, '').replace(/[\u{1F534}\u{1F535}\u{1F7E0}-\u{1F7EB}]/gu, '').split(String.fromCharCode(160)).join(' ').replace(/\s+/g, ' ').trim();
const yes = (s: string) => s.toLowerCase() === 'yes';

export type FileKind = 'tracker' | 'online' | 'physical' | 'runs1' | 'runs2' | 'expenses' | 'other';
export function identify(rows: Row[]): FileKind {
  const h = new Set(Object.keys(rows[0] ?? {}));
  if (h.has('Particulars of Bill')) return 'tracker';
  if (h.has('Funds raised being remitted') && h.has('PAFD')) return 'online';
  if (h.has('Funds raised being remitted') && h.has('Total Phy')) return 'physical';
  if (h.has('ANR 1')) return 'runs1';
  if (h.has('CAB')) return 'runs2';
  if (h.has('Expense') && h.has('Spent')) return 'expenses';
  return 'other';
}

export interface ClientRef { id: string; code: string; name: string; /** Names of the parents and students linked to the account, e.g. so “Mama Zia” finds Zia’s family. */ people?: string[] }
export interface AccountRef { id: string; code: string }

export interface LegacyInvoice { source_key: string; client_id: string | null; payer: string | null; particulars: string; invoice_ref: string | null; billing_date: string | null; received_on: string | null; amount_cents: number; receipt_generated: boolean; remitted: boolean; remitted_on: string | null; note: string | null }
export interface LegacyEntry { source_key: string; entry_no: number | null; label: string; stream: 'online' | 'physical'; client_id: string | null; received_on: string | null; amount_cents: number; re_cents: number | null; pafd_cents: number | null; jms_cents: number | null; el_cents: number | null; ew_cents: number | null; remitted: boolean; remitted_on: string | null; invoice_refs: string | null; note: string | null }
export interface LegacyExpense { source_key: string; item: string; amount_cents: number; spent_on: string; account_id: string; category: string | null; pre_agreed: boolean; notes: string | null; is_legacy: true }
export interface LegacyRun { source_key: string; zone: 'online'; run_date: string; status: 'locked'; is_legacy: true; result: Record<string, unknown> }

export interface ImportPlan { invoices: LegacyInvoice[]; entries: LegacyEntry[]; expenses: LegacyExpense[]; runs: LegacyRun[]; files: { name: string; kind: FileKind; rows: number }[]; skipped: string[] }

function distance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const words = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);

/** Match a Notion name to a client account by surname, allowing one letter of difference (Gachau / Gacau). */
export function matchClient(name: string, clients: ClientRef[]): string | null {
  const w = words(name.replace(/client acc/i, ''));
  if (w.length === 0) return null;
  const last = w[w.length - 1];
  const hits = clients.filter((c) => {
    const cw = words(c.name);
    const cl = cw[cw.length - 1];
    return cl !== undefined && (cl === last || (Math.min(cl.length, last.length) >= 5 && distance(cl, last) <= 1));
  });
  return hits.length === 1 ? hits[0].id : null;
}
/** Find the one client whose name, parents or children are mentioned most in a label like “Funds from Dorcas (Mama Lulu)”. */
export function matchByPeople(label: string, clients: ClientRef[]): string | null {
  const said = words(label);
  const same = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && distance(a, b) <= 1);
  const scores = clients
    .map((c) => {
      const names = new Set([c.name, ...(c.people ?? [])].flatMap(words));
      return { id: c.id, hits: said.filter((w) => [...names].some((n) => same(n, w))).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (scores.length === 0 || (scores.length > 1 && scores[0].hits === scores[1].hits)) return null;
  return scores[0].id;
}
const refPrefix = (ref: string) => (ref.match(/^([A-Za-z]{2,4})\//)?.[1] ?? '').toUpperCase();

export function buildPlan(files: { name: string; text: string }[], clients: ClientRef[], accounts: AccountRef[]): ImportPlan {
  const parsed = files.map((f) => { const rows = parseCsv(f.text); return { name: f.name, rows, kind: identify(rows) }; });
  const of = (kind: FileKind) => parsed.filter((p) => p.kind === kind).flatMap((p) => p.rows);
  const plan: ImportPlan = { invoices: [], entries: [], expenses: [], runs: [], files: parsed.map((p) => ({ name: p.name, kind: p.kind, rows: p.rows.length })), skipped: [] };
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));

  // --- invoices. A ref prefix is tied to a client where Notion names the client account outright (PF → Pathfinders);
  //     otherwise the client is whoever paid.
  const tracker = of('tracker');
  const prefixClient = new Map<string, string>();
  for (const r of tracker) {
    const explicit = r['Client Account'] ? matchClient(clean(r['Client Account']), clients) : null;
    if (explicit && refPrefix(r['Invoice Ref'])) prefixClient.set(refPrefix(r['Invoice Ref']), explicit);
  }
  for (const r of tracker) {
    const amount = cents(r['Revenue']);
    const particulars = clean(r['Particulars of Bill']);
    if (amount === null || !particulars) { plan.skipped.push(`Invoice without an amount or particulars: ${particulars || r['Invoice Ref'] || '(blank row)'}`); continue; }
    const ref = r['Invoice Ref'] || null;
    const payer = clean(r['Point of Payment']) || null;
    const client = (r['Client Account'] ? matchClient(clean(r['Client Account']), clients) : null) ?? prefixClient.get(refPrefix(ref ?? '')) ?? (payer ? matchClient(payer, clients) : null);
    const key = `inv|${ref ?? ''}|${particulars}|${r['Date of Billing']}|${amount}`;
    if (!once(key)) continue;
    if (ref && client && refPrefix(ref) && !prefixClient.has(refPrefix(ref))) prefixClient.set(refPrefix(ref), client);
    plan.invoices.push({
      source_key: key, client_id: client, payer, particulars, invoice_ref: ref, billing_date: parseDate(r['Date of Billing']), received_on: parseDate(r['Date of Receiving']),
      amount_cents: amount, receipt_generated: yes(r['Receipt Gen.']), remitted: yes(r['Remitted']), remitted_on: parseDate(r['Remitted On?']),
      note: [r['Note'], r['Notes']].filter(Boolean).join(' · ') || null,
    });
  }

  // --- money received. The physicals table repeats the online rows with zero physicals; only its real physical rows are kept.
  // Client for money received: the named client account, the invoice ref prefix, the invoices Notion links it to, then a surname in the label.
  const byParticulars = [...plan.invoices].filter((i) => i.client_id).sort((a, b) => b.particulars.length - a.particulars.length);
  const entryClient = (r: Row, label: string) => {
    const named = r['Client Account'] ? matchClient(clean(r['Client Account']), clients) : null;
    if (named) return named;
    for (const ref of (r['Invoice/ Receipt Ref'] ?? '').split(',')) { const hit = prefixClient.get(refPrefix(ref.trim())); if (hit) return hit; }
    const linked = clean(r['Ngome Financial Tracker'] ?? '');
    if (linked) { const hit = byParticulars.find((i) => linked.includes(i.particulars)); if (hit) return hit.client_id; }
    return matchByPeople(label, clients);
  };
  const addEntry = (r: Row, stream: 'online' | 'physical') => {
    const amount = cents(r['Received Amount']);
    const label = clean(r['Funds raised being remitted']);
    if (amount === null || !label) return;
    const key = `ent|${stream}|${r['No.']}|${label}|${amount}`;
    if (!once(key)) return;
    plan.entries.push({
      source_key: key, entry_no: /^\d+$/.test(r['No.']) ? Number(r['No.']) : null, label, stream, client_id: entryClient(r, label),
      received_on: parseDate(r['Received On'] ?? '') ?? parseDate(r['Received On?'] ?? ''), amount_cents: amount,
      re_cents: cents(r['RE'] ?? ''), pafd_cents: cents(r['PAFD'] ?? ''), jms_cents: cents(r['JMS']), el_cents: cents(r['EL']), ew_cents: cents(r['EW']),
      remitted: yes(r['Remitted']), remitted_on: parseDate(r['Remitted On?'] ?? ''), invoice_refs: r['Invoice/ Receipt Ref'] || null, note: clean(r['Notes'] ?? '') || null,
    });
  };
  for (const r of of('online')) addEntry(r, r['Class Type'] === 'PHY' ? 'physical' : 'online');
  for (const r of of('physical')) if ((cents(r['Total Phy']) ?? 0) > 0 && !seen.has(`ent|online|${r['No.']}|${clean(r['Funds raised being remitted'])}|${cents(r['Received Amount'])}`)) addEntry(r, 'physical');

  // --- expenses
  const account = (code: string) => accounts.find((a) => a.code === code)?.id ?? '';
  for (const r of of('expenses')) {
    const amount = cents(r['Spent']);
    const date = parseDate(r['Spent on']);
    const item = clean(r['Expense']);
    if (amount === null || amount <= 0 || !date || !item) { plan.skipped.push(`Expense without an amount or date: ${item || '(blank row)'}`); continue; }
    const key = `exp|${item}|${date}|${amount}`;
    if (!once(key)) continue;
    plan.expenses.push({
      source_key: key, item, amount_cents: amount, spent_on: date, is_legacy: true, pre_agreed: true,
      account_id: account(/subscription|workspace|claude|canva|domain/i.test(item) ? 'subscriptions' : 'expense'),
      category: [r['Nature of Expense'], r['Recurrence']].filter(Boolean).join(' · ') || null,
      notes: [r['Source'] && `Source: ${r['Source']}`, r['Accounted Pre-Disbursement'] && `Accounted before disbursement: ${r['Accounted Pre-Disbursement']}`, r['Notes']].filter(Boolean).join(' · ') || null,
    });
  }

  // --- balancing runs
  const addRun = (date: string | null, figures: Record<string, number | null>, name: string) => {
    if (!date) { plan.skipped.push(`Balancing run without a date: ${name}`); return; }
    if (!once(`run|${date}`)) return;
    plan.runs.push({ source_key: `run|${date}`, zone: 'online', run_date: date, status: 'locked', is_legacy: true, result: { legacy: true, ...figures } });
  };
  for (const r of of('runs1')) addRun(parseDate(r['Date']) ?? parseDate(r['Date of Balancing']), { previousBalance: cents(r['PB 1']), anr: cents(r['ANR 1']), re: cents(r['RE Totals']), contributions: cents(r['Total C']), expenses: cents(r['AELD 1']), pafd: cents(r['DP 1']), closingBalance: cents(r['CB 1']) }, r['Date of Balancing']);
  for (const r of of('runs2')) addRun(parseDate(r['Date']) ?? parseDate(r['Date of Balancing']), { anr: cents(r['CAB']), re: cents(r['RE Totals']), contributions: cents(r['TGC']), expenses: cents(r['AELD']), holding: cents(r['Holding Acc']), physicals: cents(r['Total PHY']), tinr: cents(r['TINR']), closingBalance: cents(r['Closing Balance']) }, r['Date of Balancing']);

  return plan;
}

export interface Issue { what: string; detail: string }
export function planIssues(plan: ImportPlan): Issue[] {
  const issues: Issue[] = [];
  for (const i of plan.invoices) {
    const missing = [!i.client_id && 'no client matched', !i.invoice_ref && 'no invoice ref', !i.billing_date && 'no billing date', /_{3,}/.test(i.particulars) && 'session dates left blank'].filter(Boolean);
    if (missing.length) issues.push({ what: `Invoice ${i.invoice_ref ?? ''} ${i.particulars}`.trim(), detail: missing.join(', ') });
  }
  for (const e of plan.entries) if (!e.received_on) issues.push({ what: `Money received: ${e.label}`, detail: 'no received date' });
  for (const s of plan.skipped) issues.push({ what: s, detail: 'left out' });
  return issues;
}
