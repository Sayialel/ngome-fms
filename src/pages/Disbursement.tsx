import { useQuery } from '@tanstack/react-query';
import ComingNext from '@/components/ComingNext';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchSettings, formatSetting, groupSettings, SETTINGS } from '@/lib/settings';

const RULES = ['re_percent', 'partner_shares', 'physicals_ratio', 'physicals_pay_within_days', 'run_days', 'target_closing_balance_cents'];

export default function Disbursement() {
  const { data } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const grouped = groupSettings(data ?? [], today);

  return (
    <>
      <PageHeader title="Disbursement" description="Online and physical runs, partner accounts, history and export." />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Rules in force today</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {RULES.map((key) => {
            const meta = SETTINGS.find((s) => s.key === key)!;
            const row = grouped.get(key)?.current;
            return (
              <div key={key}>
                <p className="text-sm text-muted-foreground">{meta.label}</p>
                <p className="tabular">{row ? formatSetting(meta.kind, row.value) : '—'}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>
      <ComingNext
        phase="phase 5"
        items={[
          'Online zone: guided run laid out like the disbursement sheet',
          'Physical zone: 2:1:1 split with due-date alerts',
          'Partner accounts with run results, debts and history',
          'Run history and CSV export of every movement between accounts',
        ]}
      />
    </>
  );
}
