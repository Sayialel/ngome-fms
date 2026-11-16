import { useQuery } from '@tanstack/react-query';
import ComingNext from '@/components/ComingNext';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

export default function ClientAccounts() {
  const { data: lastSync } = useQuery({
    queryKey: ['last-sync'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sync_runs')
        .select('finished_at, status')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  return (
    <>
      <PageHeader title="Client Accounts" description="What each client has been billed, has paid, has in credit and has held for future classes." />
      <Card className="mb-6">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">NUC link</p>
          <p className="text-muted-foreground">
            {lastSync?.finished_at
              ? `Last synced ${new Date(lastSync.finished_at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })} (${lastSync.status}).`
              : 'Not connected yet. Client data appears here once the read-only link to the NUC is set up.'}
          </p>
        </CardContent>
      </Card>
      <ComingNext
        phase="phases 2 and 3"
        items={[
          'Clients with outstanding, credit and held balances',
          'Client statements, invoices and payments to confirm',
          'Client forecast per student and cohort',
          'Cohort view: expected, invoiced, collected, outstanding',
        ]}
      />
    </>
  );
}
