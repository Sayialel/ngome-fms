import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKES } from '@/lib/engine/money';
import type { Client, InvoiceSummary } from '@/lib/clients';

const STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  paid: { label: 'Paid', variant: 'secondary' },
  part_paid: { label: 'Part paid', variant: 'outline' },
  unpaid: { label: 'Unpaid', variant: 'default' },
};

export default function InvoiceTable({ rows, clients }: { rows: InvoiceSummary[]; clients?: Client[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground">No invoices.</p>;
  const client = new Map((clients ?? []).map((c) => [c.id, c]));
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ref</TableHead>
            <TableHead>Billed</TableHead>
            <TableHead>Student</TableHead>
            <TableHead>Billed to</TableHead>
            {clients && <TableHead>Client</TableHead>}
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
              {clients && (
                <TableCell>
                  {r.clientId && client.get(r.clientId) ? (
                    <Link to={`/clients/${r.clientId}`} className="underline underline-offset-2">
                      {client.get(r.clientId)!.code}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
              )}
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
  );
}
