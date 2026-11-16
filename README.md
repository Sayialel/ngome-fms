# Ngome FMS

Ngome's Financial Management System: a private app for the three partners that tracks client accounts, internal accounts and disbursements. It reads billing data from the Ngome Unified Campus (NUC) and never writes to it.

See [docs/DESIGN.md](docs/DESIGN.md) for the rules, data model and build phases.

## Setup

```sh
npm install
cp .env.example .env.local
npm run dev        # http://localhost:8081
npm test           # calculation engine tests (11 Nov sheet, 11 Oct memo example)
npm run typecheck
npm run build
```

## Layout

- `src/lib/engine/` — disbursement calculations in integer cents, with tests.
- `src/pages/` — the three dashboards, Settings and Audit log.
- `supabase/migrations/` — database schema, applied to the FMS Supabase project.

## Access

There is no public sign-up. A login only works once it is linked to a partner in the `partners` table. Secret keys are never stored in this repository.
