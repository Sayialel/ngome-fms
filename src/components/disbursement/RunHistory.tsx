import { useState } from 'react';
import { Download } from 'lucide-react';
import { OnlineSheet, PhysicalSheet } from '@/components/disbursement/RunSheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { downloadText, movementsCsv, type RunData } from '@/lib/disbursement-data';
import { formatKES } from '@/lib/engine/money';

const LEGACY_FIELDS: [string, string][] = [
  ['previousBalance', 'Previous balance'], ['anr', 'All new revenue (ANR)'], ['re', 'RE'], ['contributions', 'Contributions'], ['expenses', 'Expenses (AELD)'],
  ['holding', 'Moved to Holding'], ['physicals', 'Physicals'], ['pafd', 'PAFD'], ['tinr', 'Total INR'], ['closingBalance', 'Closing balance'],
];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

export default function RunHistory({ data }: { data: RunData }) {
  const [open, setOpen] = useState<string | null>(null);
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const runs = data.runs.filter((r) => r.status === 'locked');

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <div><Label htmlFor="csv-from">From</Label><Input id="csv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div><Label htmlFor="csv-to">To</Label><Input id="csv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
        <Button variant="outline" disabled={!from || !to || from > to} onClick={() => downloadText(`ngome-movements-${from}-to-${to}.csv`, movementsCsv(data.internal, data.runs, from, to))}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
        <p className="basis-full text-sm text-muted-foreground">Every movement between accounts in the period — payments in, transfers, expenses and each run’s transfers — one line each with its explanation.</p>
      </section>

      {runs.length === 0 ? (
        <p className="text-muted-foreground">No runs locked yet.</p>
      ) : (
        <ul className="space-y-3">
          {runs.map((r) => (
            <li key={r.id} className="rounded-lg border">
              <button className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="font-medium">
                  <span className="tabular">{r.run_date}</span> · <span className="capitalize">{r.zone}</span> run {r.is_legacy && <Badge variant="outline">From Notion</Badge>}
                </span>
                <span className="tabular text-sm text-muted-foreground">
                  {r.is_legacy
                    ? `ANR ${formatKES(r.result?.anr ?? 0)} · closing balance ${formatKES(r.result?.closingBalance ?? 0)}`
                    : r.zone === 'online' ? `PAFD ${formatKES(r.result?.pafd ?? 0)} · paid to partners ${formatKES(r.result?.tinr ?? 0)}` : `Physicals ${formatKES(r.result?.total ?? 0)}`}
                </span>
              </button>
              {open === r.id && (
                <div className="border-t p-4">
                  {r.is_legacy ? (
                    <dl className="grid max-w-md grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      {LEGACY_FIELDS.filter(([k]) => r.result?.[k] !== null && r.result?.[k] !== undefined).map(([k, label]) => (
                        <div key={k} className="contents"><dt className="text-muted-foreground">{label}</dt><dd className="tabular text-right">{formatKES(r.result[k])}</dd></div>
                      ))}
                    </dl>
                  ) : r.zone === 'online' && r.result?.entries && r.result?.extras ? <OnlineSheet result={r.result} extras={r.result.extras} />
                    : r.zone === 'physical' && r.result?.entries ? <PhysicalSheet result={r.result} transfers={r.result.extras?.transfers ?? []} />
                    : <p className="text-sm text-muted-foreground">No breakdown saved for this run.</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
