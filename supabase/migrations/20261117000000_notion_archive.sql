-- History brought in from the Notion Financial Tracker. Kept as it happened and never
-- recalculated; it does not touch the ledger or account balances.

CREATE TABLE public.legacy_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id),
  payer TEXT,
  particulars TEXT NOT NULL,
  invoice_ref TEXT,
  billing_date DATE,
  received_on DATE,
  amount_cents BIGINT NOT NULL,
  receipt_generated BOOLEAN NOT NULL DEFAULT false,
  remitted BOOLEAN NOT NULL DEFAULT false,
  remitted_on DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_legacy_invoices_client ON public.legacy_invoices(client_id);

CREATE TABLE public.legacy_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  entry_no INT,
  label TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('online', 'physical')),
  client_id UUID REFERENCES public.clients(id),
  received_on DATE,
  amount_cents BIGINT NOT NULL,
  re_cents BIGINT,
  pafd_cents BIGINT,
  jms_cents BIGINT,
  el_cents BIGINT,
  ew_cents BIGINT,
  remitted BOOLEAN NOT NULL DEFAULT false,
  remitted_on DATE,
  invoice_refs TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_legacy_entries_client ON public.legacy_entries(client_id);

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS source_key TEXT UNIQUE;
ALTER TABLE public.disbursement_runs ADD COLUMN IF NOT EXISTS source_key TEXT UNIQUE;

ALTER TABLE public.legacy_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Partners manage legacy_invoices" ON public.legacy_invoices FOR ALL TO authenticated USING (public.is_partner()) WITH CHECK (public.is_partner());
CREATE POLICY "Partners manage legacy_entries" ON public.legacy_entries FOR ALL TO authenticated USING (public.is_partner()) WITH CHECK (public.is_partner());
REVOKE ALL ON public.legacy_invoices, public.legacy_entries FROM anon;

CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.legacy_invoices FOR EACH ROW EXECUTE FUNCTION public.write_audit();
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.legacy_entries FOR EACH ROW EXECUTE FUNCTION public.write_audit();
