import { useQuery } from '@tanstack/react-query';
import ComingNext from '@/components/ComingNext';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKES } from '@/lib/engine/money';
import { supabase } from '@/lib/supabase';

export default function InternalAccounts() {
  const { data, error } = useQuery({
    queryKey: ['internal-overview'],
    queryFn: async () => {
      const [balances, partners, recurring] = await Promise.all([
        supabase.from('account_balances').select('*').eq('kind', 'bank').order('sort_order'),
        supabase.from('partners').select('id, code'),
        supabase.from('recurring_expenses').select('*, account:accounts(name)').eq('active', true).order('name'),
      ]);
      if (balances.error) throw balances.error;
      if (recurring.error) throw recurring.error;
      const owner = new Map((partners.data ?? []).map((p) => [p.id, p.code]));
      return { balances: balances.data, owner, recurring: recurring.data };
    },
  });

  const monthly = (data?.recurring ?? []).filter((r) => r.frequency === 'monthly').reduce((t, r) => t + r.amount_cents, 0);

  return (
    <>
      <PageHeader title="Internal Accounts" description="Ngome's four accounts, the money moving between them, and expenses." />
      {error && <p className="text-destructive">{(error as Error).message}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(data?.balances ?? []).map((a) => (
          <Card key={a.id}>
            <CardHeader className="pb-2">
              <p className="text-sm text-muted-foreground">
                {a.name} · {data!.owner.get(a.owner_partner_id!) ?? '—'}
              </p>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold">KES {formatKES(a.balance_cents ?? 0)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Balances start at zero until opening balances are entered and confirmed by each account owner.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">Fixed and recurring expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Expense</TableHead>
                <TableHead>Frequency</TableHead>
                <TableHead>Paid from</TableHead>
                <TableHead className="text-right">Amount (KES)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.recurring ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="capitalize">{r.frequency}</TableCell>
                  <TableCell>{(r.account as { name: string } | null)?.name}</TableCell>
                  <TableCell className="tabular text-right">{formatKES(r.amount_cents)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Fixed monthly total
                </TableCell>
                <TableCell className="tabular text-right font-medium">{formatKES(monthly)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ComingNext
        phase="phase 4"
        items={[
          'Account statements showing every movement with its explanation',
          'Transfers between accounts and expense entry with receipts',
          'Provisions, monthly forecast and balance confirmation',
        ]}
      />
    </>
  );
}
