import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import ComingNext from '@/components/ComingNext';
import InvoiceTable from '@/components/InvoiceTable';
import PageHeader from '@/components/PageHeader';
import SyncButton from '@/components/SyncButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useNucData } from '@/hooks/useNucData';
import { studentClientMap, summariseInvoices, totalsByClient, type Client } from '@/lib/clients';
import { formatKES } from '@/lib/engine/money';
import { supabase } from '@/lib/supabase';

function nextCode(clients: Client[]) {
  const max = clients.reduce((m, c) => Math.max(m, Number(c.code.replace(/\D/g, '')) || 0), 0);
  return `CA-${String(max + 1).padStart(4, '0')}`;
}

function NewClientDialog({ clients, onClose }: { clients: Client[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(nextCode(clients));
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'family' | 'organisation'>('family');
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('clients').insert({ code: code.trim(), name: name.trim(), kind });
      if (error) throw new Error(error.code === '23505' ? `${code} is already in use` : error.message);
    },
    onSuccess: () => {
      toast.success(`${code} created`);
      qc.invalidateQueries({ queryKey: ['nuc-data'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New client account</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Account number</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wanjohi family" />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="family">Family</SelectItem>
                <SelectItem value="organisation">Organisation</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!code.trim() || !name.trim() || save.isPending} onClick={() => save.mutate()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientAccounts() {
  const { data, isLoading, error } = useNucData();
  const [creating, setCreating] = useState(false);

  const invoices = data ? summariseInvoices(data) : [];
  const totals = totalsByClient(invoices);
  const all = { billed: 0, paid: 0, outstanding: 0 };
  for (const i of invoices) {
    all.billed += i.amount;
    all.paid += i.paid;
    all.outstanding += i.balance;
  }

  const assigned = data ? studentClientMap(data.members) : new Map<string, string>();
  const unassignedStudents = (data?.profiles ?? []).filter((p) => p.roles.includes('student') && !p.deleted_in_nuc && !assigned.has(p.id));
  const profile = new Map((data?.profiles ?? []).map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        title="Client Accounts"
        description="What each client has been billed, has paid, has in credit and has held for future classes."
        actions={<SyncButton />}
      />
      {error && <p className="mb-4 text-destructive">{(error as Error).message}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {(
          [
            ['Billed', all.billed],
            ['Paid', all.paid],
            ['Outstanding', all.outstanding],
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

      <Tabs defaultValue="clients">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="clients">Clients ({data?.clients.length ?? 0})</TabsTrigger>
            <TabsTrigger value="invoices">Invoices ({invoices.length})</TabsTrigger>
            <TabsTrigger value="unassigned">Unassigned students ({unassignedStudents.length})</TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setCreating(true)} disabled={!data}>
            <Plus className="mr-1 h-4 w-4" /> New client
          </Button>
        </div>

        <TabsContent value="clients">
          <Card>
            <CardContent className="pt-6">
              {isLoading && <p className="text-muted-foreground">Loading…</p>}
              {data && data.clients.length === 0 && (
                <p className="text-muted-foreground">No client accounts yet. Create one, then add its parents and students.</p>
              )}
              {data && data.clients.length > 0 && (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Students</TableHead>
                        <TableHead className="text-right">Billed</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.clients.map((c) => {
                        const t = totals.get(c.id) ?? { billed: 0, paid: 0, outstanding: 0, invoices: 0 };
                        const students = data.members
                          .filter((m) => m.client_id === c.id && m.role === 'student')
                          .map((m) => profile.get(m.nuc_profile_id)?.full_name ?? 'Unknown');
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="whitespace-nowrap">
                              <Link to={`/clients/${c.id}`} className="font-medium underline underline-offset-2">
                                {c.code}
                              </Link>
                            </TableCell>
                            <TableCell>
                              {c.name} {c.kind === 'organisation' && <Badge variant="outline">Organisation</Badge>}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{students.join(', ') || 'None linked'}</TableCell>
                            <TableCell className="tabular text-right">{formatKES(t.billed)}</TableCell>
                            <TableCell className="tabular text-right">{formatKES(t.paid)}</TableCell>
                            <TableCell className="tabular text-right">{formatKES(t.outstanding)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardContent className="pt-6">
              <InvoiceTable rows={invoices} clients={data?.clients ?? []} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unassigned">
          <Card>
            <CardContent className="pt-6">
              {unassignedStudents.length === 0 ? (
                <p className="text-muted-foreground">Every NUC student belongs to a client account.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    NUC students not yet in a client account. Their invoices show as “Unassigned” until they are added to one.
                  </p>
                  <ul className="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    {unassignedStudents
                      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''))
                      .map((s) => (
                        <li key={s.id}>{s.full_name}</li>
                      ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-6">
        <ComingNext
          phase="the next step of phase 3"
          items={[
            'Payments to confirm, split into online, physical and held sessions',
            'Prepayment credit and held money per client',
            'Cohort view: expected, invoiced, collected, outstanding',
          ]}
        />
      </div>

      {creating && data && <NewClientDialog clients={data.clients} onClose={() => setCreating(false)} />}
    </>
  );
}
