-- Internal accounts: transfers, expenses and opening balances as balanced ledger transactions.

CREATE OR REPLACE FUNCTION public.record_transfer(p_from UUID, p_to UUID, p_amount_cents BIGINT, p_date DATE, p_explanation TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_txn UUID; v_from TEXT; v_to TEXT;
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can record transfers'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Choose two different accounts'; END IF;
  IF COALESCE(btrim(p_explanation), '') = '' THEN RAISE EXCEPTION 'Say what the transfer is for'; END IF;
  SELECT name INTO v_from FROM accounts WHERE id = p_from AND kind IN ('bank', 'partner');
  SELECT name INTO v_to FROM accounts WHERE id = p_to AND kind IN ('bank', 'partner');
  IF v_from IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'Account not found'; END IF;

  INSERT INTO transactions (txn_date, kind, description) VALUES (p_date, 'transfer', v_from || ' → ' || v_to || ': ' || btrim(p_explanation)) RETURNING id INTO v_txn;
  INSERT INTO entries (transaction_id, account_id, amount_cents, explanation) VALUES
    (v_txn, p_from, -p_amount_cents, btrim(p_explanation)),
    (v_txn, p_to, p_amount_cents, btrim(p_explanation));
  RETURN v_txn;
END; $$;

CREATE OR REPLACE FUNCTION public.delete_transfer(p_transaction_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can do this'; END IF;
  DELETE FROM transactions WHERE id = p_transaction_id AND kind = 'transfer';
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.record_expense(
  p_item TEXT, p_amount_cents BIGINT, p_date DATE, p_account UUID, p_category TEXT DEFAULT NULL,
  p_pre_agreed BOOLEAN DEFAULT false, p_recurring_id UUID DEFAULT NULL, p_receipt_path TEXT DEFAULT NULL, p_notes TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_txn UUID; v_id UUID;
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can record expenses'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'Enter an amount above zero'; END IF;
  IF COALESCE(btrim(p_item), '') = '' THEN RAISE EXCEPTION 'Say what the expense is'; END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account AND kind = 'bank') THEN RAISE EXCEPTION 'Choose the account it was paid from'; END IF;

  INSERT INTO transactions (txn_date, kind, description) VALUES (p_date, 'expense', btrim(p_item)) RETURNING id INTO v_txn;
  INSERT INTO entries (transaction_id, account_id, amount_cents, explanation)
  SELECT v_txn, CASE WHEN a.code = 'payees' THEN a.id ELSE p_account END,
         CASE WHEN a.code = 'payees' THEN p_amount_cents ELSE -p_amount_cents END, btrim(p_item)
  FROM accounts a WHERE a.code = 'payees' OR a.id = p_account;

  INSERT INTO expenses (item, amount_cents, spent_on, account_id, category, pre_agreed, recurring_id, receipt_path, notes, transaction_id)
  VALUES (btrim(p_item), p_amount_cents, p_date, p_account, NULLIF(btrim(p_category), ''), p_pre_agreed, p_recurring_id, p_receipt_path, NULLIF(btrim(p_notes), ''), v_txn)
  RETURNING id INTO v_id;
  UPDATE transactions SET source_table = 'expenses', source_id = v_id::TEXT WHERE id = v_txn;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.delete_expense(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_txn UUID;
BEGIN
  IF NOT public.is_partner() THEN RAISE EXCEPTION 'Only partners can do this'; END IF;
  DELETE FROM expenses WHERE id = p_id RETURNING transaction_id INTO v_txn;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF v_txn IS NOT NULL THEN DELETE FROM transactions WHERE id = v_txn; END IF;
END; $$;

-- Opening balance for one account; replaces an earlier one. Lead only.
CREATE OR REPLACE FUNCTION public.set_opening_balance(p_account UUID, p_amount_cents BIGINT, p_date DATE, p_note TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_txn UUID; v_name TEXT; v_opening UUID;
BEGIN
  IF NOT public.is_lead() THEN RAISE EXCEPTION 'Only the finance lead can set opening balances'; END IF;
  SELECT name INTO v_name FROM accounts WHERE id = p_account AND kind = 'bank';
  IF v_name IS NULL THEN RAISE EXCEPTION 'Account not found'; END IF;
  SELECT id INTO v_opening FROM accounts WHERE code = 'opening';
  DELETE FROM transactions WHERE kind = 'opening' AND source_id = p_account::TEXT;
  IF p_amount_cents = 0 THEN RETURN NULL; END IF;
  INSERT INTO transactions (txn_date, kind, description, source_table, source_id)
  VALUES (p_date, 'opening', 'Opening balance — ' || v_name, 'accounts', p_account::TEXT) RETURNING id INTO v_txn;
  INSERT INTO entries (transaction_id, account_id, amount_cents, explanation) VALUES
    (v_txn, p_account, p_amount_cents, COALESCE(NULLIF(btrim(p_note), ''), 'Opening balance')),
    (v_txn, v_opening, -p_amount_cents, 'Opening balance — ' || v_name);
  RETURN v_txn;
END; $$;

REVOKE ALL ON FUNCTION public.record_transfer(UUID, UUID, BIGINT, DATE, TEXT), public.delete_transfer(UUID),
  public.record_expense(TEXT, BIGINT, DATE, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT), public.delete_expense(UUID),
  public.set_opening_balance(UUID, BIGINT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_transfer(UUID, UUID, BIGINT, DATE, TEXT), public.delete_transfer(UUID),
  public.record_expense(TEXT, BIGINT, DATE, UUID, TEXT, BOOLEAN, UUID, TEXT, TEXT), public.delete_expense(UUID),
  public.set_opening_balance(UUID, BIGINT, DATE, TEXT) TO authenticated;

ALTER TABLE public.provisions ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id);
ALTER TABLE public.balance_confirmations ADD COLUMN IF NOT EXISTS note TEXT;

-- The day the FMS took over. Payments received on or before it were already disbursed outside the FMS.
INSERT INTO public.settings (key, value, effective_from, note)
VALUES ('cutover_date', '"2026-11-11"', '2026-11-11', 'Opening balances come from the 11 Nov 2026 disbursement sheet')
ON CONFLICT DO NOTHING;
