# Ngome Financial Management System (FMS) — Design

Status: draft for review · Owner: EL (Eric Lenina) · Date: 16 Nov 2026
Sources: Internal Finance Memo NGG/ADMN/2026/002, the 11 Nov 2026 physical disbursement sheet, EL's notebook notes and brainstorm answers, the Notion Financial Tracker export, the NUC codebase.

---

## 1. What the FMS is

A separate, private web app for the three partners (JMS, EL, EW) that tracks Ngome's money end to end:

1. **Client Accounts** — what each client has been billed, has paid, has in credit, and has held for future classes.
2. **Internal Accounts** — the four bank accounts (Revenue, Client Holding, Expense, Subscriptions), every transfer between them and every expense.
3. **Disbursement** — the bi-weekly runs (online and physical zones), partner accounts, run history and CSV export.

The three are separate dashboards over one shared set of records.

### Relationship to the NUC

| | NUC (ngomearts.com) | FMS |
|---|---|---|
| Users | Students, parents, instructors, admins | JMS, EL, EW only |
| Invoices | Raised, sent and paid here | Read from the NUC and tracked |
| Data direction | Source | Reads only; never writes to the NUC |
| Database | NUC Supabase project | Own Supabase project (`kzdjuutrsyodheypdjow`) |

The FMS never changes NUC data. Parents never use the FMS.

---

## 2. Rules (agreed)

### Revenue and RE
- **RE = 10% of each online entry.** No RE on physicals. Example: Mama Kimberly pays 10,440 → physical 3,340 + online 7,100 → RE 710.
- One payment can cover several invoice lines and both streams; the online/physical split comes from the NUC invoice line type.
- **RE is not drawn on prepayments.** It is drawn when the money becomes distributable (when it enters a run).
- RE stays in the Expense Account with no specific purpose.

### Holding
- Money for sessions **after** the run date goes to the Client Holding Account.
- Held money is **released per session** once the NUC shows that session held; it then enters the next run as revenue and RE is drawn then (e.g. MWB 2nd half, Debate weeks 5–7 on 11 Nov).
- Entrusted money (e.g. competition fees) goes to Holding and is never revenue.

### Online disbursement (runs on the 14th and month-end, any date allowed)
1. **Entries**: confirmed online money since the last locked online run + releases from Holding.
2. **RE**: 10% of each entry.
3. **Deductions**: subscriptions due (Claude 3,100), instructor pay (6,000/month), approved expenses and provisions (e.g. Fun Day 30,000 estimate), contributions (TC).
4. **PAFD** = entries − RE − deductions.
5. **Shares**: JMS 13/30, EL 17/60, EW 17/60 (= 40/25/25 + 10% split equally).
6. **INR** = share − drawings − penalties − individual contributions + reimbursements (when paid via INR) − debt repayments due.
7. **TINR**, then **closing balance** check against the target closing balance (setting; 11 Nov sheet balanced Revenue to 0).
8. **Transfer instructions** for JMS: Revenue → Holding / Expense / Subscriptions / each partner.
9. **Balance confirmation**: each owner enters their account's actual balance (+ screenshot); differences are flagged.
10. **EL locks the run** (EL's sign-off is sufficient).

### Physical disbursement
- Physical money is split JMS 2 : EL 1 : EW 1, no RE, paid within 7 days (alert when due).

### Expenses and partners
- Instructor pay (6,000/month) is paid from the Expense Account.
- Reimbursements can be paid from the Expense Account (e.g. JMS Cindy plaque 1,260) or added to INR — chosen per item.
- Partner debts (e.g. JMS 22,000) are a balance on the partner's account with an expected repayment date; overdue after that date. Repayments are recorded as paid in, or deducted at a run.

### Integrity
- Every figure (RE %, shares, physicals ratio, instructor pay, recurring expenses, payment window, run dates, target closing balance, rounding) is a **setting**, editable, with an effective date so changes never alter past runs.
- Entries and exits are **editable until the run that used them is locked**. After locking, edits create a correction carried into the next run. Every change is in the audit log.
- **No late entries**: the run syncs the NUC first and will not lock while any NUC payment or parent payment report is unconfirmed.
- Money is stored in cents; shares use exact fractions; INR rounding rule is a setting (default: down to the cent, remainder stays in Revenue).

---

## 3. NUC link (read-only)

- The NUC has one added function, `fms_export`, which returns the finance-related records as read-only data: student and parent profiles (name, email, phone), parent–student links, cohorts, sessions, enrolments, invoices, invoice parents, invoice payments and parent payment reports. It changes nothing in the NUC. The script is in `supabase/nuc/fms_readonly_export.sql`.
- The export only answers a caller presenting a secret token. The token was generated inside the FMS database and is kept in its Vault; the NUC stores only the token's hash.
- The FMS database function `sync_nuc()` calls the export and copies the result into the `nuc_*` mirror tables, marking records removed in the NUC, and logs each sync in `sync_runs`.
- Runs every 15 minutes, on "Sync now", and automatically at the start of each disbursement run.
- If a NUC invoice or payment changes after it was used in a locked run, the FMS flags it and carries the difference into the next run.
- To cut the link, drop `fms_export` and the `fms_link` schema on the NUC.

---

## 4. Data model (FMS database)

| Area | Tables |
|---|---|
| People | `partners` (JMS, EL, EW; linked login), `clients` (CA-0001…, family or organisation), `client_members` (NUC parents/students in each client; a student belongs to one client and invoices follow the student billed, a parent can be in several) |
| NUC mirrors | `nuc_profiles`, `nuc_cohorts`, `nuc_sessions`, `nuc_enrollments`, `nuc_invoices` (incl. line items + session dates), `nuc_invoice_parents`, `nuc_invoice_payments`, `nuc_payment_reports`, `sync_runs` |
| Tracking | `invoice_tracking` (FMS status: draft, in review, problem, sent, part-paid, paid, closed + notes), `payment_allocations` (payment → invoice line, online/physical, amount), `held_sessions` (amount held per session, released by run), `enrolment_rates` (rate per student per cohort, with effective date, used by the client forecast) |
| Ledger | `accounts` (Revenue, Holding, Expense, Subscriptions, partner payout accounts, external), `transactions` (date, kind, description, run, source), `entries` (transaction, account, signed amount, client, partner, explanation) |
| Expenses | `expenses` (item, amount, date, account paid from, category, pre-agreed, receipt), `recurring_expenses`, `provisions` (estimated, then trued up) |
| Partners | `partner_items` (drawing, penalty, contribution, reimbursement, debt, repayment; amount, due date, status, run) |
| Disbursement | `disbursement_runs` (zone online/physical, run date, window, status draft/locked, snapshot of every figure), `run_lines`, `balance_confirmations` (account, actual, screenshot, difference) |
| Control | `settings` (key, value, effective_from), `audit_log`, `notion_import_rows` |

All tables are locked down so only signed-in partners can read them; only EL can lock runs and change settings.

---

## 5. Screens

### Client Accounts
- **Clients**: list with outstanding, credit, held, last payment; filters by cohort and status.
- **Client statement**: bank-style running balance, invoices with session dates, payments and their allocation, held sessions and releases; per-child breakdown.
- **Invoices**: every NUC invoice with its FMS tracking status; overdue after 6 days → reminder list for JMS.
- **Payments to confirm**: NUC payments and parent reports not yet confirmed/allocated.
- **Client forecast**: per client, per student, per cohort — what we expect to be paid, built from the student's active NUC enrolments and the cohort's scheduled sessions × that student's rate. Shows, by month: expected, invoiced, paid, not yet invoiced and outstanding, so it is clear what is still to come in and what has not been paid. Rates default to the last NUC invoice price for that student and cohort and can be overridden per enrolment (parents pay at different levels).
- **Cohorts**: expected vs invoiced vs collected vs outstanding per cohort per month.

### Internal Accounts
- **Accounts**: four cards with balance and statement (−1,000 Revenue / +1,000 Expense, each with explanation).
- **Transfers** and **Expenses** (add, edit, attach receipt), **Recurring expenses**, **Provisions**.
- **Forecast**: next month's expenses and instructor pay vs Expense Account balance.
- **Balance confirmation**: actual vs system balance per account.

### Disbursement
- **Online zone**: start run → review each step (laid out like the pink sheet) → transfer instructions → confirm balances → lock.
- **Physical zone**: physical entries, 2:1:1 split, due-date alerts, lock.
- **Partner accounts**: per partner — results of each run, items (drawings, penalties, reimbursements, contributions), debts with due dates, full history.
- **Run history**: every run with full detail; printable.
- **CSV export**: every movement between accounts for a date range (date, run, from, to, amount, client/partner, explanation).

### Other
- **Settings**, **Audit log**, **Notion import**, **Sync status**.

---

## 6. Notion import (one-time)

| Notion table | Rows | Imported as |
|---|---|---|
| Client Account | 14 | Clients (CA numbers kept) |
| Financial Tracker | 108 | Historical invoices (legacy) |
| Partnership Revenue Division — virtual | 66 | Historical online entries |
| Partnership Revenue Division — physicals | 59 | Historical physical entries |
| Ngome Expenses | 22 | Expenses and recurring expenses |
| Current Balance Calculator (1) and (2) | 10 | Historical runs (legacy) |
| Cashflow / Program Cashflow schedules | 17 | Not imported (replaced by NUC enrolments and sessions) |

- History is imported **as it happened**, marked "From Notion", and not recalculated (older rows used 40/25/20/5 with WH). It never touches the ledger or account balances.
- The import runs in the app (History from Notion → Import): choose the exported CSV files, check the summary and the rows flagged for a look, then import. Importing the same files again adds nothing twice.
- Invoices go to `legacy_invoices`, money received to `legacy_entries`, expenses to `expenses` (legacy), balancing runs to `disbursement_runs` (legacy). The Cashflow schedules are not imported.
- Clients are matched from the named client account, the invoice ref prefix, the linked invoices, then the parents and children mentioned in the label ("Mama Zia"). Any row's client can be changed afterwards.
- New rules apply from the cut-over date (11 Nov 2026). Opening balances come from the 11 Nov 2026 disbursement sheet.

---

## 7. Verification

The calculation engine must reproduce, as automated tests:
- **11 Nov 2026 sheet**: entries 79,060; RE 7,572; PAFD 27,848; INR JMS 12,067.46 / EL 7,890.26 / EW 7,890.26 (exact fractions rounded down to the cent; the 0.02 remainder stays in Revenue); physicals JMS 1,670 / EL 835 / EW 835; Revenue closes at 0.
- **11 Oct 2026 memo example**: PAFD 38,220.44; TINR 39,220.
- **Late side calculation**: 4,500 − 450 RE + 2,322 = 6,372 → shares as on the sheet.

---

## 8. Build phases

1. **Foundation**: app shell (React, Vite, TypeScript, Tailwind, shadcn — same stack as the NUC), sign-in with one user (EL), database schema, settings, audit log.
2. **NUC sync**: read-only export on the NUC, sync function, mirror tables, sync status.
3. **Client Accounts** dashboard.
4. **Internal Accounts** dashboard.
5. **Disbursement**: online and physical runs, partner accounts, history, CSV export, verification tests.
6. **Notion import** and opening balances; parallel run with the next two real disbursements.
7. **Later**: JMS and EW logins, Netlify hosting.

---

## 9. Open items
- **Run timing**: assumed money for sessions up to the run date is distributed and later sessions are held (MWB pattern).
