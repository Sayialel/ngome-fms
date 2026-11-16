import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cohortSummary, monthsFrom, type NucData } from '@/lib/clients';
import { formatKES } from '@/lib/engine/money';

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }).slice(0, 7);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function CohortsTab({ data }: { data: NucData }) {
  const [start, setStart] = useState(thisMonth());
  const months = monthsFrom(start, 3);
  const rows = cohortSummary(data, months);
  const sum = (i: number, k: 'expected' | 'invoiced' | 'paid' | 'outstanding') => rows.reduce((t, r) => t + r.cells[i][k], 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="cohort-start">From month</Label>
          <Input id="cohort-start" type="month" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className="w-44" />
        </div>
        <p className="text-sm text-muted-foreground">Expected payment per cohort from active enrolments, scheduled sessions and each student’s rate.</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No active cohorts with sessions or invoices in these months.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cohort</TableHead>
                <TableHead className="text-right">Students</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right">
                    {monthLabel(m)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.cohortId} className="align-top">
                  <TableCell>
                    <p className="font-medium">{r.cohort}</p>
                    {r.missingRates > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {r.missingRates} student{r.missingRates > 1 ? 's' : ''} without a rate; not in “expected”
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">{r.students}</TableCell>
                  {r.cells.map((c) => (
                    <TableCell key={c.month} className="tabular text-right text-sm">
                      <p>
                        <span className="text-muted-foreground">expected </span>
                        <span className="font-medium">{formatKES(c.expected)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        invoiced {formatKES(c.invoiced)} · collected {formatKES(c.paid)}
                      </p>
                      {c.outstanding > 0 && <p className="text-negative">outstanding {formatKES(c.outstanding)}</p>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="align-top font-medium">
                <TableCell colSpan={2}>Total</TableCell>
                {months.map((m, i) => (
                  <TableCell key={m} className="tabular text-right text-sm">
                    <p>expected {formatKES(sum(i, 'expected'))}</p>
                    <p>invoiced {formatKES(sum(i, 'invoiced'))}</p>
                    <p>collected {formatKES(sum(i, 'paid'))}</p>
                    <p>outstanding {formatKES(sum(i, 'outstanding'))}</p>
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
