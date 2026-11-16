/* eslint-disable @typescript-eslint/no-explicit-any -- renders both a live calculation and the JSON snapshot saved with a locked run */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKES } from '@/lib/engine/money';

const ACCOUNT: Record<string, string> = {
  revenue: 'Revenue', holding: 'Client Holding', expense: 'Expense', subscriptions: 'Subscriptions', payees: 'Payees',
  partner_jms: 'JMS', partner_el: 'EL', partner_ew: 'EW',
};
const ADJ: Record<string, string> = { penalty: 'Penalty', drawing: 'Drawing', contribution: 'Contribution', reimbursement: 'Reimbursement', debt_repayment: 'Debt repayment' };

function Row({ label, value, strong, sign }: { label: string; value: number; strong?: boolean; sign?: '-' }) {
  return (
    <p className={`tabular flex justify-between gap-4 ${strong ? 'border-t pt-1 font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{sign === '-' && value !== 0 ? '− ' : ''}{formatKES(value)}</span>
    </p>
  );
}

/** The online run laid out like the paper disbursement sheet. */
export function OnlineSheet({ result, extras }: { result: any; extras: { heldTotal: number; releasedTotal: number; entrustedTotal: number; revenueAfter: number; leftForLater: number; difference: number; transfers: any[]; deductions: any[] } }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h4 className="mb-2 font-semibold">① Revenue Account — entries</h4>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Entry</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">RE</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {result.entries.map((e: any) => (
              <TableRow key={e.id}>
                <TableCell>{e.label}</TableCell>
                <TableCell className="tabular text-right">{formatKES(e.amount)}</TableCell>
                <TableCell className="tabular text-right">{e.re ? formatKES(e.re) : '—'}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="tabular text-right">{formatKES(result.totalEntries)}</TableCell>
              <TableCell className="tabular text-right">{formatKES(result.totalRE)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section className="space-y-4 text-sm">
        <div>
          <h4 className="mb-2 text-base font-semibold">PAFD</h4>
          <Row label="Entries" value={result.totalEntries} />
          <Row label="RE" value={result.totalRE} sign="-" />
          {extras.deductions.map((d: any) => <Row key={d.id} label={d.label} value={d.amount} sign="-" />)}
          <Row label="Profit available for distribution" value={result.pafd} strong />
        </div>
        <div>
          <h4 className="mb-2 text-base font-semibold">INR</h4>
          {result.partners.map((p: any) => (
            <div key={p.partner} className="mb-1">
              <Row label={`${p.partner} share`} value={p.share} />
              {p.adjustments.map((a: any) => (
                <p key={a.id} className="tabular flex justify-between gap-4 pl-4 text-muted-foreground">
                  <span>{ADJ[a.kind]} — {a.label}</span><span>{a.kind === 'reimbursement' ? '+ ' : '− '}{formatKES(a.amount)}</span>
                </p>
              ))}
              {p.adjustments.length > 0 && <Row label={`${p.partner} INR`} value={p.inr} />}
            </div>
          ))}
          <Row label="Total INR" value={result.tinr} strong />
        </div>
        <div>
          <h4 className="mb-2 text-base font-semibold">② Holding</h4>
          <Row label="Released into this run" value={extras.releasedTotal} />
          <Row label="Held for sessions after the run date" value={extras.heldTotal} />
          <Row label="Entrusted money" value={extras.entrustedTotal} />
        </div>
      </section>

      <section className="lg:col-span-2">
        <h4 className="mb-2 font-semibold">Transfers to make</h4>
        <Table>
          <TableHeader>
            <TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>For</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {extras.transfers.map((t: any, i: number) => (
              <TableRow key={i}>
                <TableCell>{ACCOUNT[t.from] ?? t.from}</TableCell>
                <TableCell>{ACCOUNT[t.to] ?? t.to}</TableCell>
                <TableCell>{t.explanation}</TableCell>
                <TableCell className="tabular text-right">{formatKES(t.amount_cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 max-w-md space-y-1 text-sm">
          <h4 className="text-base font-semibold">Revenue final calculation</h4>
          <Row label="Revenue Account after the run" value={extras.revenueAfter} />
          <Row label="Left for later (physicals, later payments)" value={extras.leftForLater} sign="-" />
          <p className={`tabular flex justify-between gap-4 border-t pt-1 font-semibold ${Math.abs(extras.difference) >= 100 ? 'text-negative' : ''}`}>
            <span>Difference from target closing balance</span><span>{formatKES(extras.difference)}</span>
          </p>
          {extras.difference > 0 && extras.difference < 100 && <p className="text-xs text-muted-foreground">Cents left by rounding each share down; carried into the next run.</p>}
        </div>
      </section>
    </div>
  );
}

export function PhysicalSheet({ result, transfers }: { result: any; transfers: any[] }) {
  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Physical session money</TableHead><TableHead>Received</TableHead><TableHead>Pay by</TableHead><TableHead className="text-right">Amount</TableHead><TableHead className="text-right">JMS</TableHead><TableHead className="text-right">EL</TableHead><TableHead className="text-right">EW</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {result.entries.map((e: any) => (
            <TableRow key={e.id}>
              <TableCell>{e.label}</TableCell>
              <TableCell className="tabular">{e.receivedOn}</TableCell>
              <TableCell className="tabular">{e.dueBy}</TableCell>
              <TableCell className="tabular text-right">{formatKES(e.amount)}</TableCell>
              {(['JMS', 'EL', 'EW'] as const).map((p) => <TableCell key={p} className="tabular text-right">{formatKES(e.split[p])}</TableCell>)}
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell colSpan={3}>Total</TableCell>
            <TableCell className="tabular text-right">{formatKES(result.total)}</TableCell>
            {(['JMS', 'EL', 'EW'] as const).map((p) => <TableCell key={p} className="tabular text-right">{formatKES(result.totals[p])}</TableCell>)}
          </TableRow>
        </TableBody>
      </Table>
      {transfers.length > 0 && (
        <ul className="text-sm">
          {transfers.map((t: any, i: number) => <li key={i} className="tabular">Revenue → {ACCOUNT[t.to] ?? t.to}: {formatKES(t.amount_cents)}</li>)}
        </ul>
      )}
    </div>
  );
}
