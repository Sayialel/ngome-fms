-- Confirming a NUC payment in the FMS: records where the money sits (Revenue Account)
-- and how it splits into online, physical and entrusted money. One transaction, undoable
-- until a disbursement run has used it.

ALTER TABLE public.payment_allocations ADD COLUMN transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE;
CREATE INDEX idx_allocations_transaction ON public.payment_allocations(transaction_id);

-- p_payment_id is NULL for an invoice marked paid in the NUC with no payment recorded.
-- p_splits: [{"stream":"online","amount_cents":710000,"line_id":"…","session_ids":["…"]}, …]
CREATE OR REPLACE FUNCTION public.confirm_payment(p_invoice_id UUID, p_payment_id UUID, p_received_on DATE, p_splits JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_inv nuc_invoices%ROWTYPE;
  v_client UUID;
  v_expected BIGINT;
  v_total BIGINT;
  v_txn UUID;
  v_label TEXT;
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can confirm payments'; END IF;

  SELECT * INTO v_inv FROM nuc_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  SELECT client_id INTO v_client FROM client_members WHERE nuc_profile_id = v_inv.student_id AND role = 'student';
  IF v_client IS NULL THEN RAISE EXCEPTION 'Add this student to a client account first'; END IF;

  IF p_payment_id IS NOT NULL THEN
    SELECT round(amount * 100) INTO v_expected FROM nuc_invoice_payments WHERE id = p_payment_id AND invoice_id = p_invoice_id AND NOT deleted_in_nuc;
    IF v_expected IS NULL THEN RAISE EXCEPTION 'Payment not found on this invoice'; END IF;
    IF EXISTS (SELECT 1 FROM payment_allocations WHERE nuc_payment_id = p_payment_id) THEN RAISE EXCEPTION 'This payment is already confirmed'; END IF;
  ELSE
    IF v_inv.status <> 'paid' THEN RAISE EXCEPTION 'This invoice has no payment to confirm'; END IF;
    SELECT round(v_inv.amount * 100) - COALESCE(round(sum(amount) * 100), 0) INTO v_expected
    FROM nuc_invoice_payments WHERE invoice_id = p_invoice_id AND NOT deleted_in_nuc;
    IF v_expected <= 0 THEN RAISE EXCEPTION 'This invoice has no unrecorded payment'; END IF;
    IF EXISTS (SELECT 1 FROM payment_allocations WHERE nuc_invoice_id = p_invoice_id AND nuc_payment_id IS NULL) THEN RAISE EXCEPTION 'This payment is already confirmed'; END IF;
  END IF;

  SELECT COALESCE(sum((s->>'amount_cents')::BIGINT), 0) INTO v_total FROM jsonb_array_elements(p_splits) s;
  IF v_total <> v_expected THEN
    RAISE EXCEPTION 'The split adds up to % but the payment is %', v_total / 100.0, v_expected / 100.0;
  END IF;

  v_label := 'Payment for invoice ' || COALESCE(v_inv.invoice_ref, '(no ref)');
  INSERT INTO transactions (txn_date, kind, description, source_table, source_id)
  VALUES (p_received_on, 'payment_in', v_label, 'nuc_invoice_payments', COALESCE(p_payment_id::TEXT, 'invoice:' || p_invoice_id))
  RETURNING id INTO v_txn;

  INSERT INTO entries (transaction_id, account_id, amount_cents, client_id, explanation)
  SELECT v_txn, a.id, CASE a.code WHEN 'revenue' THEN v_expected ELSE -v_expected END, v_client, v_label
  FROM accounts a WHERE a.code IN ('revenue', 'clients');

  INSERT INTO payment_allocations (nuc_payment_id, nuc_invoice_id, invoice_line_id, client_id, stream, amount_cents, received_on, session_ids, confirmed, transaction_id)
  SELECT p_payment_id, p_invoice_id, s->>'line_id', v_client, s->>'stream', (s->>'amount_cents')::BIGINT, p_received_on,
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'session_ids'))::UUID[], '{}'), true, v_txn
  FROM jsonb_array_elements(p_splits) s
  WHERE (s->>'amount_cents')::BIGINT > 0;

  RETURN v_txn;
END;
$$;

CREATE OR REPLACE FUNCTION public.unconfirm_payment(p_transaction_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can do this'; END IF;
  IF EXISTS (SELECT 1 FROM payment_allocations WHERE transaction_id = p_transaction_id AND run_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This payment is already in a disbursement run. Record a correction instead.';
  END IF;
  DELETE FROM transactions WHERE id = p_transaction_id AND kind = 'payment_in';  -- legs and allocations go with it
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_payment(UUID, UUID, DATE, JSONB), public.unconfirm_payment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_payment(UUID, UUID, DATE, JSONB), public.unconfirm_payment(UUID) TO authenticated;
