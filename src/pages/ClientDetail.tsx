import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X } from 'lucide-react';
import { toast } from 'sonner';
import InvoiceTable from '@/components/InvoiceTable';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNucData } from '@/hooks/useNucData';
import {
  clientForecast,
  clientStatement,
  monthsFrom,
  studentClientMap,
  summariseInvoices,
  type ForecastRow,
  type NucData,
} from '@/lib/clients';
import { formatKES, toCents } from '@/lib/engine/money';
import { supabase } from '@/lib/supabase';

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' }).slice(0, 7);
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-KE', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function Statement({ data, clientId }: { data: NucData; clientId: string }) {
  const rows = clientStatement(data, clientId);
  if (rows.length === 0) return <p className="text-muted-foreground">No invoices or payments yet.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Student</TableHead>
            <TableHead className="text-right">Charged</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Balance owed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell className="tabular whitespace-nowrap">{r.date || '—'}</TableCell>
              <TableCell className="max-w-md">{r.description}</TableCell>
              <TableCell>{r.student}</TableCell>
              <TableCell className="tabular text-right">{r.charge ? formatKES(r.charge) : ''}</TableCell>
              <TableCell className="tabular text-right text-positive">{r.payment ? formatKES(r.payment) : ''}</TableCell>
              <TableCell className="tabular text-right font-medium">{formatKES(r.balance)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RateDialog({ row, onClose }: { row: ForecastRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [rate, setRate] = useState(row.rate === null ? '' : String(row.rate / 100));
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('enrolment_rates')
        .upsert(
          { nuc_student_id: row.studentId, nuc_cohort_id: row.cohortId, rate_cents: toCents(rate), effective_from: from },
          { onConflict: 'nuc_student_id,nuc_cohort_id,effective_from' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Rate saved');
      qc.invalidateQueries({ queryKey: ['nuc-data'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const valid = rate !== '' && Number(rate) >= 0 && !!from;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rate per session</DialogTitle>
          <DialogDescription>
            {row.student} · {row.cohort}. Used for the forecast only; invoices are still raised in the NUC.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rate">Rate (KES per session)</Label>
            <Input id="rate" type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from">Applies from</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Forecast({ data, clientId }: { data: NucData; clientId: string }) {
  const [start, setStart] = useState(thisMonth());
  const [editing, setEditing] = useState<ForecastRow | null>(null);
  const months = monthsFrom(start, 3);
  const rows = clientForecast(data, clientId, months);
  const total = (m: number, key: 'expected' | 'invoiced' | 'paid' | 'notInvoiced' | 'outstanding') =>
    rows.reduce((t, r) => t + (r.cells[m][key] ?? 0), 0);
  const missingRate = rows.some((r) => r.rate === null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="start">From month</Label>
          <Input id="start" type="month" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className="w-44" />
        </div>
        <p className="text-sm text-muted-foreground">
          Expected = sessions scheduled in the NUC × the student’s rate, for cohorts they are actively enrolled in.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No scheduled sessions or invoices for this client’s students in these months.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student · Cohort</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right">
                    {monthLabel(m)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.studentId + r.cohortId} className="align-top">
                  <TableCell>
                    <p className="font-medium">{r.student}</p>
                    <p className="text-sm text-muted-foreground">{r.cohort}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <p className="tabular">{r.rate === null ? '—' : formatKES(r.rate)}</p>
                    <button className="text-xs underline underline-offset-2" onClick={() => setEditing(r)}>
                      {r.rate === null ? 'Set rate' : r.rateSource === 'last_invoice' ? 'From last invoice · change' : 'Change'}
                    </button>
                  </TableCell>
                  {r.cells.map((c) => (
                    <TableCell key={c.month} className="tabular text-right text-sm">
                      <p>
                        <span className="text-muted-foreground">{c.sessions} sessions · expected </span>
                        <span className="font-medium">{c.expected === null ? '—' : formatKES(c.expected)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        invoiced {formatKES(c.invoiced)} · paid {formatKES(c.paid)}
                      </p>
                      {(c.notInvoiced ?? 0) > 0 && <p>not yet invoiced {formatKES(c.notInvoiced!)}</p>}
                      {c.outstanding > 0 && <p className="text-negative">unpaid {formatKES(c.outstanding)}</p>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow className="align-top font-medium">
                <TableCell colSpan={2}>Total</TableCell>
                {months.map((m, i) => (
                  <TableCell key={m} className="tabular text-right text-sm">
                    <p>expected {formatKES(total(i, 'expected'))}</p>
                    <p>paid {formatKES(total(i, 'paid'))}</p>
                    <p>still to come {formatKES(total(i, 'notInvoiced') + total(i, 'outstanding'))}</p>
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      {missingRate && <p className="mt-3 text-sm text-muted-foreground">Rows without a rate are left out of the expected totals until you set one.</p>}
      {editing && <RateDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Members({ data, clientId }: { data: NucData; clientId: string }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const profile = new Map(data.profiles.map((p) => [p.id, p]));
  const mine = data.members.filter((m) => m.client_id === clientId);
  const mineIds = new Set(mine.map((m) => m.nuc_profile_id));
  const takenStudents = studentClientMap(data.members);
  const done = () => qc.invalidateQueries({ queryKey: ['nuc-data'] });

  const candidates = data.profiles
    .filter((p) => !p.deleted_in_nuc && !mineIds.has(p.id))
    .filter((p) => p.roles.includes('parent') || (p.roles.includes('student') && !takenStudents.has(p.id)))
    .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));

  const add = useMutation({
    mutationFn: async (profileId: string) => {
      const p = profile.get(profileId)!;
      const isParent = p.roles.includes('parent');
      const rows = [{ client_id: clientId, nuc_profile_id: profileId, role: isParent ? 'parent' : 'student' }];
      // Adding a parent brings in their children who aren't in a client account yet.
      if (isParent) {
        for (const l of data.links.filter((l) => l.parent_id === profileId)) {
          if (!takenStudents.has(l.student_id) && !mineIds.has(l.student_id)) {
            rows.push({ client_id: clientId, nuc_profile_id: l.student_id, role: 'student' });
          }
        }
      }
      const { error } = await supabase.from('client_members').insert(rows);
      if (error) throw error;
      return rows.length - 1;
    },
    onSuccess: (children) => {
      toast.success(children > 0 ? `Added, with ${children} linked student${children > 1 ? 's' : ''}` : 'Added');
      setPick('');
      done();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_members').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: done,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1">
          <Label>Add a parent or student from the NUC</Label>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger>
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.full_name} · {p.roles.includes('parent') ? 'parent' : 'student'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={!pick || add.isPending} onClick={() => add.mutate(pick)}>
          Add
        </Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Invoices follow the student billed, so each student belongs to one client account. A parent can be in more than one.
      </p>
      {mine.length === 0 ? (
        <p className="text-muted-foreground">Nobody linked yet.</p>
      ) : (
        <ul className="divide-y">
          {mine
            .sort((a, b) => a.role.localeCompare(b.role))
            .map((m) => {
              const p = profile.get(m.nuc_profile_id);
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <span className="font-medium">{p?.full_name ?? 'Unknown'}</span>{' '}
                    <Badge variant="outline" className="capitalize">
                      {m.role}
                    </Badge>
                    {m.role !== 'student' && p && (
                      <p className="text-sm text-muted-foreground">{[p.email, p.phone].filter(Boolean).join(' · ')}</p>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${p?.full_name ?? 'member'}`} onClick={() => remove.mutate(m.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
        </ul>
      )}
    </>
  );
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useNucData();
  const client = data?.clients.find((c) => c.id === id);

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  if (!data || !client) return <p>Client account not found.</p>;

  const invoices = summariseInvoices(data).filter((i) => i.clientId === client.id);
  const billed = invoices.reduce((t, i) => t + i.amount, 0);
  const paid = invoices.reduce((t, i) => t + i.paid, 0);

  return (
    <>
      <Link to="/clients" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All clients
      </Link>
      <PageHeader title={`${client.code} · ${client.name}`} description={client.kind === 'organisation' ? 'Organisation' : 'Family'} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {(
          [
            ['Billed', billed],
            ['Paid', paid],
            ['Outstanding', billed - paid],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <p className="text-sm text-muted-foreground">{label}</p>
            </CardHeader>
            <CardContent>
              <p className="tabular text-2xl font-semibold">KES {formatKES(value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="statement">
        <TabsList>
          <TabsTrigger value="statement">Statement</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
          <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="members">Parents &amp; students</TabsTrigger>
        </TabsList>
        {(
          [
            ['statement', 'Statement', <Statement data={data} clientId={client.id} />],
            ['forecast', 'Forecast', <Forecast data={data} clientId={client.id} />],
            ['invoices', 'Invoices', <InvoiceTable rows={invoices} />],
            ['members', 'Parents & students', <Members data={data} clientId={client.id} />],
          ] as const
        ).map(([value, title, body]) => (
          <TabsContent key={value} value={value}>
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">{title}</CardTitle>
              </CardHeader>
              <CardContent>{body}</CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
