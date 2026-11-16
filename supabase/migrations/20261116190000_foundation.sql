-- ============================================================
-- Ngome FMS — foundation schema
-- Partners-only access, settings with effective dates, audit log,
-- double-entry ledger, clients, expenses, partner items, runs,
-- and read-only mirrors of NUC data.
-- All money is stored as integer cents (BIGINT).
-- ============================================================

-- ---------------------------------------------------------------- partners
CREATE TABLE public.partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code IN ('JMS', 'EL', 'EW')),
  full_name TEXT NOT NULL,
  email TEXT,
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  is_lead BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Access helpers. SECURITY DEFINER so policies on partners itself don't recurse.
CREATE OR REPLACE FUNCTION public.is_partner()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM partners WHERE user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_lead()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM partners WHERE user_id = auth.uid() AND is_lead);
$$;

CREATE OR REPLACE FUNCTION public.current_partner_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM partners WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.is_partner(), public.is_lead(), public.current_partner_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_partner(), public.is_lead(), public.current_partner_id() TO authenticated;

-- ---------------------------------------------------------------- settings
CREATE TABLE public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  effective_from DATE NOT NULL,
  note TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, effective_from)
);

-- The value of a setting in force on a given date.
CREATE OR REPLACE FUNCTION public.setting_on(p_key TEXT, p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT value FROM settings
  WHERE key = p_key AND effective_from <= p_date
  ORDER BY effective_from DESC LIMIT 1;
$$;

-- ---------------------------------------------------------------- accounts
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bank', 'partner', 'external')),
  owner_partner_id UUID REFERENCES public.partners(id),
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- clients
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,                       -- CA-0001
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'family' CHECK (kind IN ('family', 'organisation')),
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.client_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  nuc_profile_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent', 'student', 'contact')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, nuc_profile_id)
);
CREATE INDEX idx_client_members_profile ON public.client_members(nuc_profile_id);

-- ---------------------------------------------------------------- disbursement runs
CREATE TABLE public.disbursement_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone TEXT NOT NULL CHECK (zone IN ('online', 'physical')),
  run_date DATE NOT NULL,
  window_start DATE,
  window_end DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  is_legacy BOOLEAN NOT NULL DEFAULT false,         -- imported from Notion, not recalculated
  settings_snapshot JSONB,
  result JSONB,
  notes TEXT,
  locked_by UUID,
  locked_at TIMESTAMPTZ,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_runs_zone_date ON public.disbursement_runs(zone, run_date DESC);

-- ---------------------------------------------------------------- ledger
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'opening', 'payment_in', 'transfer', 'expense', 'release', 'disbursement',
    'physical_payout', 'partner_item', 'correction'
  )),
  description TEXT NOT NULL,
  run_id UUID REFERENCES public.disbursement_runs(id),
  source_table TEXT,
  source_id TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_date ON public.transactions(txn_date);
CREATE INDEX idx_transactions_run ON public.transactions(run_id);

-- Each leg of a transaction: −1,000 from Revenue, +1,000 to Expense, each with its explanation.
CREATE TABLE public.entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
  client_id UUID REFERENCES public.clients(id),
  partner_id UUID REFERENCES public.partners(id),
  explanation TEXT
);
CREATE INDEX idx_entries_account ON public.entries(account_id);
CREATE INDEX idx_entries_transaction ON public.entries(transaction_id);
CREATE INDEX idx_entries_client ON public.entries(client_id);

-- Every transaction must balance (legs sum to zero). Checked at commit so legs can be inserted one by one.
CREATE OR REPLACE FUNCTION public.check_transaction_balanced()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_txn UUID := COALESCE(NEW.transaction_id, OLD.transaction_id);
  v_sum BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM transactions WHERE id = v_txn) THEN
    RETURN NULL;  -- transaction deleted with its legs
  END IF;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_sum FROM entries WHERE transaction_id = v_txn;
  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'Transaction % does not balance (legs sum to % cents)', v_txn, v_sum;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_entries_balanced
  AFTER INSERT OR UPDATE OR DELETE ON public.entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_transaction_balanced();

CREATE OR REPLACE VIEW public.account_balances WITH (security_invoker = true) AS
SELECT a.id, a.code, a.name, a.kind, a.owner_partner_id, a.sort_order,
       COALESCE(SUM(e.amount_cents), 0)::BIGINT AS balance_cents
FROM accounts a
LEFT JOIN entries e ON e.account_id = a.id
GROUP BY a.id;

-- ---------------------------------------------------------------- expenses
CREATE TABLE public.recurring_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
  frequency TEXT NOT NULL CHECK (frequency IN ('monthly', 'yearly', 'occasional')),
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  next_due DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  spent_on DATE NOT NULL,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  category TEXT,
  pre_agreed BOOLEAN NOT NULL DEFAULT false,
  recurring_id UUID REFERENCES public.recurring_expenses(id),
  receipt_path TEXT,
  notes TEXT,
  transaction_id UUID REFERENCES public.transactions(id),
  run_id UUID REFERENCES public.disbursement_runs(id),
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_expenses_spent_on ON public.expenses(spent_on);

CREATE TABLE public.provisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  estimated_cents BIGINT NOT NULL CHECK (estimated_cents >= 0),
  actual_cents BIGINT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
  run_id UUID REFERENCES public.disbursement_runs(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- partner items
CREATE TABLE public.partner_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.partners(id),
  kind TEXT NOT NULL CHECK (kind IN ('drawing', 'penalty', 'contribution', 'reimbursement', 'debt', 'repayment')),
  label TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  item_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,                                    -- debts: expected repayment date
  pay_via TEXT CHECK (pay_via IN ('inr', 'expense_account', 'direct')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'settled')),
  debt_id UUID REFERENCES public.partner_items(id), -- repayment → the debt it reduces
  run_id UUID REFERENCES public.disbursement_runs(id),
  notes TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_items_partner ON public.partner_items(partner_id, item_date DESC);

CREATE TABLE public.balance_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES public.disbursement_runs(id),
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  as_of DATE NOT NULL,
  actual_cents BIGINT NOT NULL,
  system_cents BIGINT NOT NULL,
  screenshot_path TEXT,
  confirmed_by UUID DEFAULT auth.uid(),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- NUC mirrors (filled only by the sync)
CREATE TABLE public.nuc_profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  roles TEXT[] NOT NULL DEFAULT '{}',
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.nuc_parent_student_links (
  id UUID PRIMARY KEY,
  parent_id UUID NOT NULL,
  student_id UUID NOT NULL,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.nuc_cohorts (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.nuc_sessions (
  id UUID PRIMARY KEY,
  cohort_id UUID NOT NULL,
  title TEXT,
  session_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_nuc_sessions_cohort_date ON public.nuc_sessions(cohort_id, session_date);

CREATE TABLE public.nuc_enrollments (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL,
  cohort_id UUID NOT NULL,
  status TEXT,
  enrolled_at TIMESTAMPTZ,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.nuc_invoices (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL,
  cohort_id UUID,
  particulars TEXT,
  invoice_ref TEXT,
  billing_date DATE,
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT,
  paid_at TIMESTAMPTZ,
  document JSONB,                                   -- line items: kind, cohort, session ids and dates, price
  created_at TIMESTAMPTZ,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_nuc_invoices_student ON public.nuc_invoices(student_id);

CREATE TABLE public.nuc_invoice_parents (
  invoice_id UUID NOT NULL,
  parent_id UUID NOT NULL,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, parent_id)
);

CREATE TABLE public.nuc_invoice_payments (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  paid_on DATE,
  method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_nuc_invoice_payments_invoice ON public.nuc_invoice_payments(invoice_id);

-- Parents' "I've paid" reports (NUC public.payments).
CREATE TABLE public.nuc_payment_reports (
  id UUID PRIMARY KEY,
  parent_id UUID,
  student_id UUID,
  amount NUMERIC(12, 2),
  transaction_ref TEXT,
  status TEXT,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ,
  deleted_in_nuc BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  counts JSONB,
  error TEXT,
  triggered_by UUID
);

-- ---------------------------------------------------------------- tracking (FMS view of NUC billing)
CREATE TABLE public.invoice_tracking (
  nuc_invoice_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'in_review', 'problem', 'sent', 'part_paid', 'paid', 'closed')),
  client_id UUID REFERENCES public.clients(id),
  notes TEXT,
  updated_by UUID DEFAULT auth.uid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- How a payment is split: which invoice line, online or physical or entrusted, and which sessions it pays for.
CREATE TABLE public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nuc_payment_id UUID,                              -- NULL for money not recorded in the NUC (e.g. legacy)
  nuc_invoice_id UUID,
  invoice_line_id TEXT,
  client_id UUID NOT NULL REFERENCES public.clients(id),
  stream TEXT NOT NULL CHECK (stream IN ('online', 'physical', 'entrusted', 'credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  received_on DATE NOT NULL,
  session_ids UUID[] NOT NULL DEFAULT '{}',
  confirmed BOOLEAN NOT NULL DEFAULT false,
  run_id UUID REFERENCES public.disbursement_runs(id),
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_allocations_client ON public.payment_allocations(client_id);
CREATE INDEX idx_allocations_payment ON public.payment_allocations(nuc_payment_id);

-- Money for sessions after a run date, sitting in the Holding Account until the session is held.
CREATE TABLE public.held_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id UUID NOT NULL REFERENCES public.payment_allocations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id),
  nuc_session_id UUID,
  session_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  held_in_run UUID REFERENCES public.disbursement_runs(id),
  released_in_run UUID REFERENCES public.disbursement_runs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_held_sessions_open ON public.held_sessions(session_date) WHERE released_in_run IS NULL;

-- Rate per session for a student in a cohort (parents pay at different levels). Used by the client forecast.
CREATE TABLE public.enrolment_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nuc_student_id UUID NOT NULL,
  nuc_cohort_id UUID NOT NULL,
  rate_cents BIGINT NOT NULL CHECK (rate_cents >= 0),
  effective_from DATE NOT NULL,
  note TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nuc_student_id, nuc_cohort_id, effective_from)
);

-- ---------------------------------------------------------------- Notion import staging
CREATE TABLE public.notion_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table TEXT NOT NULL,
  row_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'needs_review', 'imported', 'skipped')),
  issue TEXT,
  mapped_table TEXT,
  mapped_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- audit log
CREATE TABLE public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID DEFAULT auth.uid(),
  table_name TEXT NOT NULL,
  row_id TEXT,
  action TEXT NOT NULL,
  old_data JSONB,
  new_data JSONB
);
CREATE INDEX idx_audit_log_at ON public.audit_log(at DESC);

CREATE OR REPLACE FUNCTION public.write_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO audit_log (table_name, row_id, action, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(v_row->>'id', v_row->>'nuc_invoice_id'),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'partners', 'settings', 'accounts', 'clients', 'client_members', 'disbursement_runs', 'transactions',
    'entries', 'recurring_expenses', 'expenses', 'provisions', 'partner_items', 'balance_confirmations',
    'invoice_tracking', 'payment_allocations', 'held_sessions', 'enrolment_rates'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.write_audit()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- locked runs are final
-- Rows used by a locked run can't be changed or deleted; corrections go into the next run.
CREATE OR REPLACE FUNCTION public.guard_locked_run_rows()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_run UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE COALESCE(OLD.run_id, NEW.run_id) END;
BEGIN
  IF v_run IS NOT NULL AND EXISTS (SELECT 1 FROM disbursement_runs WHERE id = v_run AND status = 'locked') THEN
    RAISE EXCEPTION 'This record belongs to a locked disbursement run. Record a correction instead.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['transactions', 'expenses', 'provisions', 'partner_items', 'payment_allocations'] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_guard_locked BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_locked_run_rows()', t);
  END LOOP;
END $$;

-- Legs of a transaction in a locked run are final too.
CREATE OR REPLACE FUNCTION public.guard_locked_entries()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM transactions t JOIN disbursement_runs r ON r.id = t.run_id
    WHERE t.id = COALESCE(OLD.transaction_id, NEW.transaction_id) AND r.status = 'locked'
  ) THEN
    RAISE EXCEPTION 'This entry belongs to a locked disbursement run. Record a correction instead.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER trg_guard_locked BEFORE UPDATE OR DELETE ON public.entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_locked_entries();

-- Only the lead (EL) locks runs; a locked run can't be edited or unlocked.
CREATE OR REPLACE FUNCTION public.guard_run_lock()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'locked' THEN RAISE EXCEPTION 'Locked runs cannot be deleted.'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'locked' THEN
    RAISE EXCEPTION 'This run is locked and cannot be changed.';
  END IF;
  IF NEW.status = 'locked' THEN
    IF NOT public.is_lead() THEN RAISE EXCEPTION 'Only the finance lead can lock a run.'; END IF;
    NEW.locked_by := auth.uid();
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_run_lock BEFORE UPDATE OR DELETE ON public.disbursement_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_run_lock();

-- ---------------------------------------------------------------- row level security
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'clients', 'client_members', 'disbursement_runs', 'transactions', 'entries',
    'recurring_expenses', 'expenses', 'provisions', 'partner_items', 'balance_confirmations',
    'invoice_tracking', 'payment_allocations', 'held_sessions', 'enrolment_rates', 'notion_import_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Partners manage %1$s" ON public.%1$I FOR ALL TO authenticated USING (public.is_partner()) WITH CHECK (public.is_partner())', t);
  END LOOP;

  -- NUC mirrors and sync log: partners read; only the sync (service role) writes.
  FOREACH t IN ARRAY ARRAY[
    'nuc_profiles', 'nuc_parent_student_links', 'nuc_cohorts', 'nuc_sessions', 'nuc_enrollments',
    'nuc_invoices', 'nuc_invoice_parents', 'nuc_invoice_payments', 'nuc_payment_reports', 'sync_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Partners read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.is_partner())', t);
  END LOOP;
END $$;

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners read partners" ON public.partners FOR SELECT TO authenticated USING (public.is_partner());
CREATE POLICY "Lead manages partners" ON public.partners FOR ALL TO authenticated USING (public.is_lead()) WITH CHECK (public.is_lead());

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners read settings" ON public.settings FOR SELECT TO authenticated USING (public.is_partner());
CREATE POLICY "Lead changes settings" ON public.settings FOR ALL TO authenticated USING (public.is_lead()) WITH CHECK (public.is_lead());

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners read audit log" ON public.audit_log FOR SELECT TO authenticated USING (public.is_partner());

-- Nothing is visible to signed-out visitors.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------- receipts and screenshots (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('finance-files', 'finance-files', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Partners read finance files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'finance-files' AND public.is_partner());
CREATE POLICY "Partners upload finance files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'finance-files' AND public.is_partner());
CREATE POLICY "Partners replace finance files" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'finance-files' AND public.is_partner());
