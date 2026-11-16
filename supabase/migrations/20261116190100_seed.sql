-- Partners, accounts, default settings and recurring expenses (Finance Memo NGG/ADMN/2026/002).
-- Logins are linked to partners separately once each partner's account exists.

INSERT INTO public.partners (code, full_name, is_lead) VALUES
  ('JMS', 'Jeff Melita Sayialel', false),
  ('EL', 'Eric Lenina', true),
  ('EW', 'Eliana Wijenje', false);

INSERT INTO public.accounts (code, name, kind, owner_partner_id, description, sort_order)
SELECT v.code, v.name, v.kind, p.id, v.description, v.sort_order
FROM (VALUES
  ('revenue', 'Revenue Account', 'bank', 'JMS', 'Receives all client payments; every disbursement and transfer is made from here', 1),
  ('holding', 'Client Holding Account', 'bank', 'EW', 'Client money billed but not yet earned, and money held in trust for clients', 2),
  ('expense', 'Expense Account', 'bank', 'EL', 'Retained earnings and pre-agreed group expenses, including instructor pay', 3),
  ('subscriptions', 'Subscriptions Account', 'bank', 'EL', 'Recurring subscriptions (software, tools)', 4),
  ('partner_jms', 'JMS — personal', 'partner', 'JMS', 'Payouts to Jeff Melita Sayialel', 10),
  ('partner_el', 'EL — personal', 'partner', 'EL', 'Payouts to Eric Lenina', 11),
  ('partner_ew', 'EW — personal', 'partner', 'EW', 'Payouts to Eliana Wijenje', 12),
  ('clients', 'Clients (money in)', 'external', NULL, 'Source of client payments', 20),
  ('payees', 'Payees (money out)', 'external', NULL, 'Suppliers, instructors and other payments out', 21),
  ('opening', 'Opening balances', 'external', NULL, 'Balances brought in when the FMS started', 22)
) AS v(code, name, kind, owner, description, sort_order)
LEFT JOIN public.partners p ON p.code = v.owner;

INSERT INTO public.settings (key, value, effective_from, note) VALUES
  ('re_percent', '10', '2026-10-15', 'RE: 10% of each online client entry; none on physicals'),
  ('partner_shares', '{"JMS":{"num":13,"den":30},"EL":{"num":17,"den":60},"EW":{"num":17,"den":60}}', '2026-10-15', '40/25/25 plus the remaining 10% split equally'),
  ('physicals_ratio', '{"JMS":2,"EL":1,"EW":1}', '2026-10-15', 'Physicals split 2:1:1'),
  ('physicals_pay_within_days', '7', '2026-10-15', 'Physicals disbursed within 1 week'),
  ('inr_rounding', '"cent"', '2026-10-15', 'Round each INR down to the cent; the remainder stays in Revenue'),
  ('target_closing_balance_cents', '0', '2026-10-15', 'Revenue Account balance left after an online run'),
  ('payment_window_days', '6', '2026-10-15', 'Days a parent has to pay after an invoice is sent'),
  ('invoice_raise_day', '24', '2026-10-15', 'Invoices for next month raised on the 24th'),
  ('run_days', '["14","month_end"]', '2026-10-15', 'Disbursement on the 14th and the last day of the month');

INSERT INTO public.recurring_expenses (name, amount_cents, frequency, account_id, notes)
SELECT v.name, v.amount, v.frequency, a.id, v.notes
FROM (VALUES
  ('Claude', 310000, 'monthly', 'subscriptions', 'Fixed monthly subscription'),
  ('Instructors', 600000, 'monthly', 'expense', 'Fixed monthly instructor pay'),
  ('Canva', 90000, 'occasional', 'subscriptions', 'Only in months it is needed')
) AS v(name, amount, frequency, account, notes)
JOIN public.accounts a ON a.code = v.account;
