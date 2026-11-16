-- Trigger functions are only for triggers; nobody calls them through the API.
REVOKE EXECUTE ON FUNCTION public.write_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_transaction_balanced() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_locked_run_rows() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_locked_entries() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_run_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.setting_on(TEXT, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.setting_on(TEXT, DATE) TO authenticated;
