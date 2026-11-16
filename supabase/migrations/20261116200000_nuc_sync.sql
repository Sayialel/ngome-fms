-- NUC → FMS sync. Read-only: calls the NUC's token-protected export and copies
-- the result into the nuc_* mirror tables. Nothing is ever written to the NUC.
-- Needs three Vault secrets: nuc_url, nuc_api_key (the NUC's publishable key) and nuc_export_token.

CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.sync_nuc()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_run UUID;
  v_url TEXT;
  v_key TEXT;
  v_token TEXT;
  v_resp extensions.http_response;
  d JSONB;
  v_counts JSONB;
BEGIN
  -- Partners (signed in) or the scheduler (no JWT) only.
  IF auth.uid() IS NOT NULL AND NOT public.is_partner() THEN
    RAISE EXCEPTION 'Only partners can sync';
  END IF;

  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'nuc_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'nuc_api_key';
  SELECT decrypted_secret INTO v_token FROM vault.decrypted_secrets WHERE name = 'nuc_export_token';
  IF v_url IS NULL OR v_key IS NULL OR v_token IS NULL THEN
    RAISE EXCEPTION 'The NUC link is not configured';
  END IF;

  INSERT INTO sync_runs (triggered_by) VALUES (auth.uid()) RETURNING id INTO v_run;

  BEGIN
    PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');
    SELECT * INTO v_resp FROM extensions.http((
      'POST', v_url || '/rest/v1/rpc/fms_export',
      ARRAY[extensions.http_header('apikey', v_key), extensions.http_header('Authorization', 'Bearer ' || v_key)],
      'application/json', jsonb_build_object('p_token', v_token)::TEXT
    )::extensions.http_request);

    IF v_resp.status <> 200 THEN
      RAISE EXCEPTION 'NUC answered % %', v_resp.status, left(v_resp.content, 200);
    END IF;
    d := v_resp.content::JSONB;

    -- profiles
    INSERT INTO nuc_profiles (id, full_name, email, phone, roles, deleted_in_nuc, synced_at)
    SELECT x.id, x.full_name, x.email, x.phone, COALESCE(x.roles, '{}'), false, now()
    FROM jsonb_to_recordset(d->'profiles') AS x(id UUID, full_name TEXT, email TEXT, phone TEXT, roles TEXT[])
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, phone = EXCLUDED.phone,
      roles = EXCLUDED.roles, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_profiles SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'profiles') e);

    -- parent ↔ student links
    INSERT INTO nuc_parent_student_links (id, parent_id, student_id, deleted_in_nuc, synced_at)
    SELECT x.id, x.parent_id, x.student_id, false, now()
    FROM jsonb_to_recordset(d->'parent_student_links') AS x(id UUID, parent_id UUID, student_id UUID)
    ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, student_id = EXCLUDED.student_id, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_parent_student_links SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'parent_student_links') e);

    -- cohorts
    INSERT INTO nuc_cohorts (id, name, start_date, end_date, is_active, deleted_in_nuc, synced_at)
    SELECT x.id, x.name, x.start_date, x.end_date, x.is_active, false, now()
    FROM jsonb_to_recordset(d->'cohorts') AS x(id UUID, name TEXT, start_date DATE, end_date DATE, is_active BOOLEAN)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
      is_active = EXCLUDED.is_active, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_cohorts SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'cohorts') e);

    -- sessions
    INSERT INTO nuc_sessions (id, cohort_id, title, session_date, start_time, end_time, deleted_in_nuc, synced_at)
    SELECT x.id, x.cohort_id, x.title, x.session_date, x.start_time, x.end_time, false, now()
    FROM jsonb_to_recordset(d->'sessions') AS x(id UUID, cohort_id UUID, title TEXT, session_date DATE, start_time TIME, end_time TIME)
    ON CONFLICT (id) DO UPDATE SET cohort_id = EXCLUDED.cohort_id, title = EXCLUDED.title, session_date = EXCLUDED.session_date,
      start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_sessions SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'sessions') e);

    -- enrolments
    INSERT INTO nuc_enrollments (id, student_id, cohort_id, status, enrolled_at, deleted_in_nuc, synced_at)
    SELECT x.id, x.student_id, x.cohort_id, x.status, x.enrolled_at, false, now()
    FROM jsonb_to_recordset(d->'enrollments') AS x(id UUID, student_id UUID, cohort_id UUID, status TEXT, enrolled_at TIMESTAMPTZ)
    ON CONFLICT (id) DO UPDATE SET student_id = EXCLUDED.student_id, cohort_id = EXCLUDED.cohort_id, status = EXCLUDED.status,
      enrolled_at = EXCLUDED.enrolled_at, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_enrollments SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'enrollments') e);

    -- invoices
    INSERT INTO nuc_invoices (id, student_id, cohort_id, particulars, invoice_ref, billing_date, amount, status, paid_at, document, created_at, deleted_in_nuc, synced_at)
    SELECT x.id, x.student_id, x.cohort_id, x.particulars, x.invoice_ref, x.billing_date, x.amount, x.status, x.paid_at, x.document, x.created_at, false, now()
    FROM jsonb_to_recordset(d->'invoices') AS x(id UUID, student_id UUID, cohort_id UUID, particulars TEXT, invoice_ref TEXT,
      billing_date DATE, amount NUMERIC, status TEXT, paid_at TIMESTAMPTZ, document JSONB, created_at TIMESTAMPTZ)
    ON CONFLICT (id) DO UPDATE SET student_id = EXCLUDED.student_id, cohort_id = EXCLUDED.cohort_id, particulars = EXCLUDED.particulars,
      invoice_ref = EXCLUDED.invoice_ref, billing_date = EXCLUDED.billing_date, amount = EXCLUDED.amount, status = EXCLUDED.status,
      paid_at = EXCLUDED.paid_at, document = EXCLUDED.document, created_at = EXCLUDED.created_at, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_invoices SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'invoices') e);

    -- invoice ↔ parent
    INSERT INTO nuc_invoice_parents (invoice_id, parent_id, deleted_in_nuc, synced_at)
    SELECT x.invoice_id, x.parent_id, false, now()
    FROM jsonb_to_recordset(d->'invoice_parents') AS x(invoice_id UUID, parent_id UUID)
    ON CONFLICT (invoice_id, parent_id) DO UPDATE SET deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_invoice_parents SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND (invoice_id, parent_id) NOT IN (
      SELECT (e->>'invoice_id')::UUID, (e->>'parent_id')::UUID FROM jsonb_array_elements(d->'invoice_parents') e);

    -- payments recorded against invoices
    INSERT INTO nuc_invoice_payments (id, invoice_id, amount, paid_on, method, reference, notes, created_at, deleted_in_nuc, synced_at)
    SELECT x.id, x.invoice_id, x.amount, x.paid_on, x.method, x.reference, x.notes, x.created_at, false, now()
    FROM jsonb_to_recordset(d->'invoice_payments') AS x(id UUID, invoice_id UUID, amount NUMERIC, paid_on DATE, method TEXT,
      reference TEXT, notes TEXT, created_at TIMESTAMPTZ)
    ON CONFLICT (id) DO UPDATE SET invoice_id = EXCLUDED.invoice_id, amount = EXCLUDED.amount, paid_on = EXCLUDED.paid_on,
      method = EXCLUDED.method, reference = EXCLUDED.reference, notes = EXCLUDED.notes, created_at = EXCLUDED.created_at,
      deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_invoice_payments SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'invoice_payments') e);

    -- parents' "I've paid" reports
    INSERT INTO nuc_payment_reports (id, parent_id, student_id, amount, transaction_ref, status, paid_at, notes, created_at, deleted_in_nuc, synced_at)
    SELECT x.id, x.parent_id, x.student_id, x.amount, x.transaction_ref, x.status, x.paid_at, x.notes, x.created_at, false, now()
    FROM jsonb_to_recordset(d->'payment_reports') AS x(id UUID, parent_id UUID, student_id UUID, amount NUMERIC, transaction_ref TEXT,
      status TEXT, paid_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ)
    ON CONFLICT (id) DO UPDATE SET parent_id = EXCLUDED.parent_id, student_id = EXCLUDED.student_id, amount = EXCLUDED.amount,
      transaction_ref = EXCLUDED.transaction_ref, status = EXCLUDED.status, paid_at = EXCLUDED.paid_at, notes = EXCLUDED.notes,
      created_at = EXCLUDED.created_at, deleted_in_nuc = false, synced_at = now();
    UPDATE nuc_payment_reports SET deleted_in_nuc = true
    WHERE NOT deleted_in_nuc AND id NOT IN (SELECT (e->>'id')::UUID FROM jsonb_array_elements(d->'payment_reports') e);

    v_counts := jsonb_build_object(
      'profiles', jsonb_array_length(d->'profiles'),
      'cohorts', jsonb_array_length(d->'cohorts'),
      'sessions', jsonb_array_length(d->'sessions'),
      'enrollments', jsonb_array_length(d->'enrollments'),
      'invoices', jsonb_array_length(d->'invoices'),
      'invoice_payments', jsonb_array_length(d->'invoice_payments'),
      'payment_reports', jsonb_array_length(d->'payment_reports'));

    UPDATE sync_runs SET status = 'ok', finished_at = now(), counts = v_counts WHERE id = v_run;
    RETURN jsonb_build_object('status', 'ok', 'counts', v_counts);
  EXCEPTION WHEN OTHERS THEN
    UPDATE sync_runs SET status = 'failed', finished_at = now(), error = SQLERRM WHERE id = v_run;
    RETURN jsonb_build_object('status', 'failed', 'error', SQLERRM);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_nuc() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_nuc() TO authenticated;

-- Every 15 minutes.
SELECT cron.schedule('nuc-sync', '*/15 * * * *', 'SELECT public.sync_nuc()');
