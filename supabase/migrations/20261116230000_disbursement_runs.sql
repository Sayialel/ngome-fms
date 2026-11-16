-- Disbursement: locking a run writes every movement to the ledger in one go.
-- Amounts are calculated by the tested engine in the app; this function records them,
-- checks nothing changed underneath, and refuses to leave the Revenue Account negative.

ALTER TABLE public.provisions ADD COLUMN IF NOT EXISTS funded BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.lock_run(p_zone TEXT, p_run_date DATE, p_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_run UUID; t JSONB; v_txn UUID; v_from UUID; v_to UUID; v_amt BIGINT; v_n INT; v_rev BIGINT;
  v_partner UUID;
BEGIN
  IF NOT public.is_lead() THEN RAISE EXCEPTION 'Only the finance lead can lock a run'; END IF;
  IF p_zone NOT IN ('online', 'physical') THEN RAISE EXCEPTION 'Unknown zone'; END IF;
  IF jsonb_array_length(COALESCE(p_payload->'transfers', '[]')) = 0 THEN RAISE EXCEPTION 'There is nothing to disburse'; END IF;

  -- No payment may slip through: every NUC payment for a client must be confirmed first.
  IF EXISTS (
    SELECT 1 FROM nuc_invoice_payments p
    JOIN nuc_invoices i ON i.id = p.invoice_id AND NOT i.deleted_in_nuc
    JOIN client_members m ON m.nuc_profile_id = i.student_id AND m.role = 'student'
    WHERE NOT p.deleted_in_nuc AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.nuc_payment_id = p.id)
  ) THEN
    RAISE EXCEPTION 'Confirm every payment recorded in the NUC before locking a run';
  END IF;

  INSERT INTO disbursement_runs (zone, run_date, window_end, status, settings_snapshot, result, notes)
  VALUES (p_zone, p_run_date, p_run_date, 'draft', p_payload->'settings', p_payload->'result', NULLIF(p_payload->>'notes', ''))
  RETURNING id INTO v_run;

  FOR t IN SELECT * FROM jsonb_array_elements(p_payload->'transfers') LOOP
    SELECT id INTO v_from FROM accounts WHERE code = t->>'from';
    SELECT id INTO v_to FROM accounts WHERE code = t->>'to';
    v_amt := (t->>'amount_cents')::BIGINT;
    IF v_from IS NULL OR v_to IS NULL OR v_from = v_to OR v_amt IS NULL OR v_amt <= 0 THEN
      RAISE EXCEPTION 'Invalid transfer in run: %', t;
    END IF;
    SELECT id INTO v_partner FROM partners WHERE code = t->>'partner';
    INSERT INTO transactions (txn_date, kind, description, run_id)
    VALUES (p_run_date, COALESCE(t->>'kind', 'disbursement'), t->>'explanation', v_run) RETURNING id INTO v_txn;
    INSERT INTO entries (transaction_id, account_id, amount_cents, partner_id, client_id, explanation) VALUES
      (v_txn, v_from, -v_amt, v_partner, NULLIF(t->>'client_id', '')::UUID, t->>'explanation'),
      (v_txn, v_to, v_amt, v_partner, NULLIF(t->>'client_id', '')::UUID, t->>'explanation');
  END LOOP;

  -- Payments used by this run.
  UPDATE payment_allocations SET run_id = v_run
  WHERE id IN (SELECT (x #>> '{}')::UUID FROM jsonb_array_elements(COALESCE(p_payload->'allocation_ids', '[]')) x)
    AND run_id IS NULL AND confirmed AND NOT is_legacy;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> jsonb_array_length(COALESCE(p_payload->'allocation_ids', '[]')) THEN
    RAISE EXCEPTION 'Payments changed since this run was calculated. Recalculate and try again.';
  END IF;

  -- Money held for sessions after the run date.
  INSERT INTO held_sessions (allocation_id, client_id, nuc_session_id, session_date, amount_cents, held_in_run)
  SELECT (h->>'allocation_id')::UUID, (h->>'client_id')::UUID, NULLIF(h->>'nuc_session_id', '')::UUID,
         (h->>'session_date')::DATE, (h->>'amount_cents')::BIGINT, v_run
  FROM jsonb_array_elements(COALESCE(p_payload->'held', '[]')) h;

  -- Held money released because its sessions have now happened.
  UPDATE held_sessions SET released_in_run = v_run
  WHERE id IN (SELECT (x #>> '{}')::UUID FROM jsonb_array_elements(COALESCE(p_payload->'release_ids', '[]')) x)
    AND released_in_run IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> jsonb_array_length(COALESCE(p_payload->'release_ids', '[]')) THEN
    RAISE EXCEPTION 'Held money changed since this run was calculated. Recalculate and try again.';
  END IF;

  -- Partner items applied in this run, and debt repayments taken from shares.
  UPDATE partner_items SET status = 'applied', run_id = v_run
  WHERE id IN (SELECT (x #>> '{}')::UUID FROM jsonb_array_elements(COALESCE(p_payload->'partner_item_ids', '[]')) x) AND status = 'open';

  INSERT INTO partner_items (partner_id, kind, label, amount_cents, item_date, pay_via, status, debt_id, run_id)
  SELECT d.partner_id, 'repayment', 'Repayment from share — ' || d.label, (r->>'amount_cents')::BIGINT, p_run_date, 'inr', 'applied', d.id, v_run
  FROM jsonb_array_elements(COALESCE(p_payload->'repayments', '[]')) r
  JOIN partner_items d ON d.id = (r->>'debt_id')::UUID AND d.kind = 'debt';

  UPDATE provisions SET funded = true, run_id = v_run
  WHERE id IN (SELECT (x #>> '{}')::UUID FROM jsonb_array_elements(COALESCE(p_payload->'provision_ids', '[]')) x) AND NOT funded;

  SELECT balance_cents INTO v_rev FROM account_balances WHERE code = 'revenue';
  IF v_rev < 0 THEN RAISE EXCEPTION 'This run would take the Revenue Account below zero (by KES %)', round(-v_rev / 100.0, 2); END IF;

  UPDATE disbursement_runs SET status = 'locked' WHERE id = v_run;
  RETURN v_run;
END; $$;

-- A partner pays money back into an account against a debt.
CREATE OR REPLACE FUNCTION public.record_partner_repayment(p_debt_id UUID, p_amount_cents BIGINT, p_date DATE, p_account UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE d partner_items%ROWTYPE; v_txn UUID; v_paccount UUID; v_id UUID; v_code TEXT;
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can do this'; END IF;
  SELECT * INTO d FROM partner_items WHERE id = p_debt_id AND kind = 'debt';
  IF NOT FOUND THEN RAISE EXCEPTION 'Debt not found'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND kind = 'bank') THEN RAISE EXCEPTION 'Choose the account it was paid into'; END IF;
  SELECT code INTO v_code FROM partners WHERE id = d.partner_id;
  SELECT id INTO v_paccount FROM accounts WHERE code = 'partner_' || lower(v_code);

  INSERT INTO transactions (txn_date, kind, description) VALUES (p_date, 'partner_item', v_code || ' repayment — ' || d.label) RETURNING id INTO v_txn;
  INSERT INTO entries (transaction_id, account_id, amount_cents, partner_id, explanation) VALUES
    (v_txn, v_paccount, -p_amount_cents, d.partner_id, 'Repayment — ' || d.label),
    (v_txn, p_account, p_amount_cents, d.partner_id, v_code || ' repayment — ' || d.label);
  INSERT INTO partner_items (partner_id, kind, label, amount_cents, item_date, pay_via, status, debt_id)
  VALUES (d.partner_id, 'repayment', 'Repayment — ' || d.label, p_amount_cents, p_date, 'direct', 'settled', d.id) RETURNING id INTO v_id;
  UPDATE transactions SET source_table = 'partner_items', source_id = v_id::TEXT WHERE id = v_txn;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.lock_run(TEXT, DATE, JSONB), public.record_partner_repayment(UUID, BIGINT, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_run(TEXT, DATE, JSONB), public.record_partner_repayment(UUID, BIGINT, DATE, UUID) TO authenticated;
