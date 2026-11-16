import { useQuery } from '@tanstack/react-query';
import OnlineRun from '@/components/disbursement/OnlineRun';
import PartnerAccounts from '@/components/disbursement/PartnerAccounts';
import PhysicalRun from '@/components/disbursement/PhysicalRun';
import RunHistory from '@/components/disbursement/RunHistory';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { fetchRunData } from '@/lib/disbursement-data';

export default function Disbursement() {
  const { data, isLoading, error } = useQuery({ queryKey: ['run-data'], queryFn: fetchRunData });
  const physicalWaiting = data?.unrun.filter((a) => a.stream === 'physical').length ?? 0;

  return (
    <>
      <PageHeader title="Disbursement" description="Online and physical runs, partner accounts, history and export." />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {data && (
        <Tabs defaultValue="online">
          <TabsList>
            <TabsTrigger value="online">Online run</TabsTrigger>
            <TabsTrigger value="physical">Physicals run{physicalWaiting ? ` (${physicalWaiting})` : ''}</TabsTrigger>
            <TabsTrigger value="partners">Partner accounts</TabsTrigger>
            <TabsTrigger value="history">History &amp; export</TabsTrigger>
          </TabsList>
          <TabsContent value="online"><Card><CardContent className="pt-6"><OnlineRun data={data} /></CardContent></Card></TabsContent>
          <TabsContent value="physical"><Card><CardContent className="pt-6"><PhysicalRun data={data} /></CardContent></Card></TabsContent>
          <TabsContent value="partners"><PartnerAccounts data={data} /></TabsContent>
          <TabsContent value="history"><Card><CardContent className="pt-6"><RunHistory data={data} /></CardContent></Card></TabsContent>
        </Tabs>
      )}
    </>
  );
}
