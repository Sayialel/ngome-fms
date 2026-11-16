-- A student belongs to exactly one client account; invoices follow the student billed.
-- (A parent can appear in more than one, e.g. their own family and an organisation they are the contact for.)
CREATE UNIQUE INDEX client_members_one_client_per_student ON public.client_members(nuc_profile_id) WHERE role = 'student';
