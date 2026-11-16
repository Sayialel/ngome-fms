import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import ComingNext from '@/components/ComingNext';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKES } from '@/lib/engine/money';
import { fetchInvoices, fetchLastSync, syncNow } from '@/lib/nuc';

const STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  paid: { label: 'Paid', variant: 'secondary' },
  part_paid: { label: 'Part paid', variant: 'outline' },
  unpaid: { label: 'Unpaid', variant: 'default' },
};

function when(iso: string) {
  return new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
}

export default function ClientAccounts() {
  const qc = useQueryClient();
  const { data: lastSync } = useQuery({ queryKey: ['last-sync'], queryFn: fetchLastSync });
  const { data: invoices, isLoading, error } = useQuery({ queryKey: ['nuc-invoices'], queryFn: fetchInvoices });

  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: () => {
      toast.success('Synced with the NUC');
      qc.invalidateQueries();
    },
    onError: (e: Error) => {
      toast.error(`Sync failed: ${e.message}`);
      qc.invalidateQueries({ queryKey: ['last-sync'] });
    },
  });

  const rows = invoices ?? [];
  const billed = rows.reduce((t, r) => t + r.amount, 0);
  const paid = rows.reduce((t, r) => t + r.paid, 0);
  const outstanding = rows.reduce((t, r) => t + r.balance, 0);

  return (
    <>
      <PageHeader
        title="Client Accounts"
        description="What each client has been billed, has paid, has in credit and has held for future classes."
        actions={
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              {lastSync?.finished_at
                ? lastSync.status === 'ok'
                  ? `NUC synced ${when(lastSync.finished_at)}`
                  : `Last sync failed ${when(lastSync.finished_at)}`
                : 'Not synced yet'}
            </p>
            <Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
              <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
              {sync.isPending ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        }
      />

      {lastSync?.status === 'failed' && <p className="mb-4 text-sm text-destructive">Last sync error: {lastSync.error}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          ['Billed', billed],
          ['Paid', paid],
          ['Outstanding', outstanding],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <CardHeader className="pb-2">
              <p className="text-sm text-muted-foreground">{label}</p>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold">KES {formatKES(value as number)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Invoices from the NUC</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-destructive">{(error as Error).message}</p>}
          {!isLoading && rows.length === 0 && <p className="text-muted-foreground">No invoices synced yet.</p>}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Billed</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Billed to</TableHead>
                    <TableHead>Cohort</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{r.ref ?? '—'}</TableCell>
                      <TableCell className="tabular whitespace-nowrap">{r.billingDate ?? '—'}</TableCell>
                      <TableCell>{r.student}</TableCell>
                      <TableCell>{r.parents.join(', ') || '—'}</TableCell>
                      <TableCell>{r.cohort ?? '—'}</TableCell>
                      <TableCell className="tabular text-right">{formatKES(r.amount)}</TableCell>
                      <TableCell className="tabular text-right">{formatKES(r.paid)}</TableCell>
                      <TableCell className="tabular text-right">{formatKES(r.balance)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                        {r.paidWithoutRecord && <p className="mt-1 text-xs text-muted-foreground">Marked paid; no payment recorded</p>}
                        {!r.hasLines && <p className="mt-1 text-xs text-muted-foreground">No line items</p>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <ComingNext
        phase="phase 3"
        items={[
          'Client accounts (CA numbers) grouping parents and students, with statements',
          'Payments to confirm and allocation to online, physical and held sessions',
          'Client forecast per student and cohort',
          'Cohort view: expected, invoiced, collected, outstanding',
        ]}
      />
    </>
  );
}
