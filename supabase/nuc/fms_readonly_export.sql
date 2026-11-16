-- Run on the NUC database (not the FMS). Adds a read-only export for the FMS.
-- It changes no NUC data: one private schema, one config row (a token hash) and one function.
-- The FMS presents a secret token; only its SHA-256 hash is stored here.
-- To cut the link: DROP SCHEMA fms_link CASCADE; DROP FUNCTION public.fms_export(text);

CREATE SCHEMA IF NOT EXISTS fms_link;
REVOKE ALL ON SCHEMA fms_link FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS fms_link.config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  token_hash TEXT NOT NULL
);
REVOKE ALL ON fms_link.config FROM PUBLIC, anon, authenticated;

INSERT INTO fms_link.config (token_hash) VALUES (:'token_hash')
ON CONFLICT (id) DO UPDATE SET token_hash = EXCLUDED.token_hash;

CREATE OR REPLACE FUNCTION public.fms_export(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_token IS NULL OR NOT EXISTS (
    SELECT 1 FROM fms_link.config WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'exported_at', now(),
    -- Only students and parents; staff-only profiles are not exported.
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'roles', r.roles))
      FROM profiles p
      JOIN LATERAL (SELECT array_agg(ur.role::TEXT ORDER BY ur.role::TEXT) AS roles FROM user_roles ur WHERE ur.user_id = p.id) r ON true
      WHERE r.roles && ARRAY['student', 'parent']
    ), '[]'::JSONB),
    'parent_student_links', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'student_id', student_id)) FROM parent_student_links), '[]'::JSONB),
    'cohorts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'start_date', start_date, 'end_date', end_date, 'is_active', is_active)) FROM cohorts), '[]'::JSONB),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'cohort_id', cohort_id, 'title', title, 'session_date', session_date, 'start_time', start_time, 'end_time', end_time)) FROM sessions), '[]'::JSONB),
    'enrollments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id, 'cohort_id', cohort_id, 'status', status, 'enrolled_at', enrolled_at)) FROM enrollments), '[]'::JSONB),
    'invoices', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'student_id', student_id, 'cohort_id', cohort_id, 'particulars', particulars, 'invoice_ref', invoice_ref, 'billing_date', billing_date, 'amount', amount, 'status', status, 'paid_at', paid_at, 'document', document, 'created_at', created_at)) FROM invoices), '[]'::JSONB),
    'invoice_parents', COALESCE((SELECT jsonb_agg(jsonb_build_object('invoice_id', invoice_id, 'parent_id', parent_id)) FROM invoice_parents), '[]'::JSONB),
    'invoice_payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'invoice_id', invoice_id, 'amount', amount, 'paid_on', paid_on, 'method', method, 'reference', reference, 'notes', notes, 'created_at', created_at)) FROM invoice_payments), '[]'::JSONB),
    'payment_reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'parent_id', parent_id, 'student_id', student_id, 'amount', amount, 'transaction_ref', transaction_ref, 'status', status, 'paid_at', paid_at, 'notes', notes, 'created_at', created_at)) FROM payments), '[]'::JSONB)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fms_export(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fms_export(TEXT) TO anon;
