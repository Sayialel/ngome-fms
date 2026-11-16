import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useNucData } from '@/hooks/useNucData';
import type { NucData } from '@/lib/clients';
import { formatKES } from '@/lib/engine/money';
import { buildPlan, planIssues, type ImportPlan, type LegacyEntry, type LegacyInvoice } from '@/lib/notion-import';
import { supabase } from '@/lib/supabase';

type Saved<T> = T & { id: string };
const KIND_LABEL: Record<string, string> = { tracker: 'Invoices', online: 'Money received (online)', physical: 'Money received (physicals)', runs1: 'Balancing runs', runs2: 'Balancing runs', expenses: 'Expenses', other: 'Not used' };

async function fetchArchive() {
  const [invoices, entries] = await Promise.all([
    supabase.from('legacy_invoices').select('*').order('billing_date', { ascending: false, nullsFirst: false }),
    supabase.from('legacy_entries').select('*').order('received_on', { ascending: false, nullsFirst: false }),
  ]);
  if (invoices.error) throw invoices.error;
  if (entries.error) throw entries.error;
  return { invoices: invoices.data as Saved<LegacyInvoice>[], entries: entries.data as Saved<LegacyEntry>[] };
}

function ClientSelect({ nuc, value, onChange }: { nuc: NucData; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Select value={value ?? 'none'} onValueChange={(v) => onChange(v === 'none' ? null : v)}>
      <SelectTrigger className="h-8 w-44" aria-label="Client account"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No client</SelectItem>
        {nuc.clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function Import({ nuc }: { nuc: NucData }) {
  const qc = useQueryClient();
  const { partner } = useAuth();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; code: string }[]>([]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = await Promise.all([...list].filter((f) => f.name.toLowerCase().endsWith('.csv')).map(async (f) => ({ name: f.name, text: await f.text() })));
    const { data, error } = await supabase.from('accounts').select('id, code');
    if (error) return toast.error(error.message);
    setAccounts(data);
    const profile = new Map(nuc.profiles.map((p) => [p.id, p.full_name ?? '']));
    const clients = nuc.clients.map((c) => ({ id: c.id, code: c.code, name: c.name, people: nuc.members.filter((m) => m.client_id === c.id).map((m) => profile.get(m.nuc_profile_id) ?? '') }));
    setPlan(buildPlan(files, clients, data));
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!plan) return;
      const put = async (table: string, rows: object[]) => {
        if (rows.length === 0) return;
        const { error } = await supabase.from(table).upsert(rows, { onConflict: 'source_key', ignoreDuplicates: true });
        if (error) throw new Error(`${table}: ${error.message}`);
      };
      await put('legacy_invoices', plan.invoices);
      await put('legacy_entries', plan.entries);
      await put('expenses', plan.expenses);
      await put('disbursement_runs', plan.runs);
    },
    onSuccess: () => {
      toast.success('Notion history imported');
      setPlan(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const issues = plan ? planIssues(plan) : [];
  const missingAccounts = accounts.length > 0 && plan?.expenses.some((e) => !e.account_id);
  const name = new Map(nuc.clients.map((c) => [c.id, c.code]));

  return (
    <div className="space-y-5">
      <div className="space-y-2 text-sm">
        <p>Bring in the history from the Notion Financial Tracker. It is kept exactly as it happened, marked “From Notion”, and does not change any account balance.</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>In Notion, export the Ngome Financial Tracker page as Markdown &amp; CSV, with subpages, and unzip it.</li>
          <li>Choose all the CSV files below. Files the import doesn’t need are ignored, and importing twice adds nothing twice.</li>
          <li>Check the summary, then import.</li>
        </ol>
      </div>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center hover:bg-muted/50">
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="font-medium">Choose the exported CSV files</span>
        <Input type="file" accept=".csv" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </label>

      {plan && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {([['Invoices', plan.invoices.length], ['Money received', plan.entries.length], ['Expenses', plan.expenses.length], ['Balancing runs', plan.runs.length]] as const).map(([label, n]) => (
              <Card key={label}><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="tabular text-2xl font-semibold">{n}</p></CardContent></Card>
            ))}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Files read ({plan.files.length})</summary>
            <ul className="mt-1 space-y-0.5">{plan.files.map((f, i) => <li key={i}>{f.name} — {KIND_LABEL[f.kind]}{f.kind !== 'other' ? `, ${f.rows} rows` : ''}</li>)}</ul>
          </details>
          <p className="text-sm">
            Invoices matched to a client: {plan.invoices.filter((i) => i.client_id).length} of {plan.invoices.length}. Money received matched: {plan.entries.filter((e) => e.client_id).length} of {plan.entries.length}.
            You can set or change the client on any row after importing.
          </p>
          {issues.length > 0 && (
            <details className="text-sm" open={issues.length <= 12}>
              <summary className="cursor-pointer font-medium">{issues.length} rows to look at (they are still imported unless marked “left out”)</summary>
              <ul className="mt-2 space-y-1">{issues.map((i, n) => <li key={n}><span className="text-muted-foreground">{i.detail}:</span> {i.what}</li>)}</ul>
            </details>
          )}
          {plan.entries.some((e) => !e.client_id) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Money received without a client ({plan.entries.filter((e) => !e.client_id).length})</summary>
              <ul className="mt-1 space-y-0.5">{plan.entries.filter((e) => !e.client_id).map((e) => <li key={e.source_key}>{e.label}</li>)}</ul>
            </details>
          )}
          {plan.entries.some((e) => e.client_id) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Check the matches for money received</summary>
              <ul className="mt-1 space-y-0.5">{plan.entries.filter((e) => e.client_id).map((e) => <li key={e.source_key}><span className="tabular">{name.get(e.client_id!)}</span> ← {e.label}</li>)}</ul>
            </details>
          )}
          {missingAccounts && <p className="text-sm text-destructive">The Expense or Subscriptions account could not be found.</p>}
          {!partner?.is_lead && <p className="text-sm text-destructive">Only the finance lead can import history.</p>}
          <Button disabled={!partner?.is_lead || !!missingAccounts || save.isPending || plan.invoices.length + plan.entries.length + plan.expenses.length + plan.runs.length === 0} onClick={() => save.mutate()}>
            {save.isPending ? 'Importing…' : 'Import history'}
          </Button>
        </>
      )}
    </div>
  );
}

export default function History() {
  const qc = useQueryClient();
  const { data: nuc } = useNucData();
  const { data, error } = useQuery({ queryKey: ['archive'], queryFn: fetchArchive });
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);

  const setClient = useMutation({
    mutationFn: async (v: { table: 'legacy_invoices' | 'legacy_entries'; id: string; client_id: string | null }) => {
      const { error } = await supabase.from(v.table).update({ client_id: v.client_id }).eq('id', v.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['archive'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const invoices = (data?.invoices ?? []).filter((i) => !onlyUnmatched || !i.client_id);
  const entries = (data?.entries ?? []).filter((e) => !onlyUnmatched || !e.client_id);
  const empty = data && data.invoices.length + data.entries.length === 0;

  return (
    <>
      <PageHeader title="History from Notion" description="Invoices and money received before the FMS took over. Read-only records; balances are not affected." />
      {error && <p className="mb-4 text-destructive">{(error as Error).message}</p>}
      {nuc && (
        <Tabs defaultValue={empty ? 'import' : 'invoices'} key={empty ? 'empty' : 'filled'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="invoices">Invoices ({data?.invoices.length ?? 0})</TabsTrigger>
              <TabsTrigger value="entries">Money received ({data?.entries.length ?? 0})</TabsTrigger>
              <TabsTrigger value="import">Import</TabsTrigger>
            </TabsList>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> Only rows without a client</label>
          </div>

          <TabsContent value="invoices">
            <Card><CardContent className="overflow-x-auto pt-6">
              {invoices.length === 0 ? <p className="text-muted-foreground">Nothing to show.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Billed</TableHead><TableHead>Ref</TableHead><TableHead>Particulars</TableHead><TableHead>Paid by</TableHead><TableHead>Client</TableHead><TableHead>Received</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {invoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="tabular whitespace-nowrap">{i.billing_date ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{i.invoice_ref ?? '—'}</TableCell>
                        <TableCell className="max-w-sm">{i.particulars}{i.note && <p className="text-xs text-muted-foreground">{i.note}</p>}</TableCell>
                        <TableCell>{i.payer ?? '—'}</TableCell>
                        <TableCell><ClientSelect nuc={nuc} value={i.client_id} onChange={(client_id) => setClient.mutate({ table: 'legacy_invoices', id: i.id, client_id })} /></TableCell>
                        <TableCell className="tabular whitespace-nowrap">{i.received_on ?? <Badge variant="outline">Not received</Badge>}</TableCell>
                        <TableCell className="tabular text-right">{formatKES(i.amount_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="entries">
            <Card><CardContent className="overflow-x-auto pt-6">
              {entries.length === 0 ? <p className="text-muted-foreground">Nothing to show.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Received</TableHead><TableHead>Entry</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">RE</TableHead><TableHead className="text-right">JMS</TableHead><TableHead className="text-right">EL</TableHead><TableHead className="text-right">EW</TableHead><TableHead>Remitted</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="tabular whitespace-nowrap">{e.received_on ?? '—'}</TableCell>
                        <TableCell className="max-w-xs">{e.label} {e.stream === 'physical' && <Badge variant="outline">Physical</Badge>}{e.invoice_refs && <p className="text-xs text-muted-foreground">{e.invoice_refs}</p>}</TableCell>
                        <TableCell><ClientSelect nuc={nuc} value={e.client_id} onChange={(client_id) => setClient.mutate({ table: 'legacy_entries', id: e.id, client_id })} /></TableCell>
                        <TableCell className="tabular text-right">{formatKES(e.amount_cents)}</TableCell>
                        {[e.re_cents, e.jms_cents, e.el_cents, e.ew_cents].map((v, n) => <TableCell key={n} className="tabular text-right">{v === null ? '—' : formatKES(v)}</TableCell>)}
                        <TableCell className="tabular whitespace-nowrap">{e.remitted ? (e.remitted_on ?? 'Yes') : 'No'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="import"><Card><CardContent className="pt-6"><Import nuc={nuc} /></CardContent></Card></TabsContent>
        </Tabs>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        Imported expenses appear under <Link className="underline" to="/internal">Internal Accounts → Expenses</Link> and balancing runs under <Link className="underline" to="/disbursement">Disbursement → History</Link>, each marked “From Notion”.
      </p>
    </>
  );
}
