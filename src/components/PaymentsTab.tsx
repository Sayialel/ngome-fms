import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { paymentItems, type NucData, type PaymentItem, type Stream } from '@/lib/clients';
import { formatKES, toCents } from '@/lib/engine/money';
import { fetchSettings } from '@/lib/settings';
import { supabase } from '@/lib/supabase';

const STREAMS: { key: Exclude<Stream, 'credit'>; label: string; help: string }[] = [
  { key: 'online', label: 'Online classes', help: 'RE is drawn on this at disbursement.' },
  { key: 'physical', label: 'Physical sessions', help: 'Split 2:1:1 in the physical zone; no RE.' },
  { key: 'entrusted', label: 'Entrusted money', help: 'Held for the client (e.g. competition fees); never revenue.' },
];
const STREAM_LABEL: Record<Stream, string> = { online: 'Online', physical: 'Physical', entrusted: 'Entrusted', credit: 'Credit' };

function ConfirmDialog({ item, onClose }: { item: PaymentItem; onClose: () => void }) {
  const qc = useQueryClient();
  const suggested = (s: Stream) => item.suggested.find((x) => x.stream === s);
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(STREAMS.map((s) => [s.key, suggested(s.key) ? String(suggested(s.key)!.amount_cents / 100) : ''])),
  );
  const [date, setDate] = useState(item.date);
  const cents = (k: string) => (amounts[k] === '' || Number.isNaN(Number(amounts[k])) ? 0 : toCents(amounts[k]));
  const total = STREAMS.reduce((t, s) => t + cents(s.key), 0);
  const diff = item.amount - total;

  const save = useMutation({
    mutationFn: async () => {
      const splits = STREAMS.filter((s) => cents(s.key) > 0).map((s) => ({
        stream: s.key,
        amount_cents: cents(s.key),
        session_ids: s.key === 'online' ? (suggested('online')?.session_ids ?? []) : [],
      }));
      const { error } = await supabase.rpc('confirm_payment', {
        p_invoice_id: item.invoiceId,
        p_payment_id: item.paymentId,
        p_received_on: date,
        p_splits: splits,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Payment confirmed into the Revenue Account');
      qc.invalidateQueries();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm payment · KES {formatKES(item.amount)}</DialogTitle>
          <DialogDescription>
            {item.student} · invoice {item.ref ?? '(no ref)'}.{' '}
            {item.hasLines
              ? 'The split below comes from the invoice lines.'
              : 'This invoice has no line items, so say how the money splits.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {STREAMS.map((s) => (
            <div key={s.key} className="space-y-1">
              <Label htmlFor={s.key}>{s.label} (KES)</Label>
              <Input id={s.key} type="number" min="0" step="0.01" value={amounts[s.key]} onChange={(e) => setAmounts({ ...amounts, [s.key]: e.target.value })} />
              <p className="text-xs text-muted-foreground">{s.help}</p>
            </div>
          ))}
          <div className="space-y-1">
            <Label htmlFor="date">Date received</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {diff !== 0 && (
            <p className="text-sm text-destructive">
              {diff > 0 ? `KES ${formatKES(diff)} still to assign.` : `KES ${formatKES(-diff)} more than the payment.`}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={diff !== 0 || !date || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Confirming…' : 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PaymentsTab({ data }: { data: NucData }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<PaymentItem | null>(null);
  const items = paymentItems(data);
  const client = new Map(data.clients.map((c) => [c.id, c]));
  const pending = items.filter((i) => !i.confirmed);
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const cutover = (settings?.find((r) => r.key === 'cutover_date')?.value as string | undefined) ?? null;
  const beforeCutover = (i: PaymentItem) => !!cutover && !!i.date && i.date <= cutover;

  // Money received before the FMS took over was already disbursed; note the split without touching the Revenue Account.
  const markLegacy = useMutation({
    mutationFn: async (i: PaymentItem) => {
      const { error } = await supabase.from('payment_allocations').insert(
        i.suggested.map((s) => ({
          nuc_payment_id: i.paymentId, nuc_invoice_id: i.invoiceId, client_id: i.clientId, stream: s.stream, amount_cents: s.amount_cents,
          received_on: i.date, confirmed: true, is_legacy: true, notes: 'Received and disbursed before the FMS cut-over',
        })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Marked as handled before cut-over');
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const undoLegacy = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('payment_allocations').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries(),
    onError: (e: Error) => toast.error(e.message),
  });

  const undo = useMutation({
    mutationFn: async (transactionId: string) => {
      const { error } = await supabase.rpc('unconfirm_payment', { p_transaction_id: transactionId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Confirmation undone');
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (items.length === 0) return <p className="text-muted-foreground">No payments recorded in the NUC yet.</p>;

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {pending.length === 0
          ? 'Every payment recorded in the NUC is confirmed.'
          : `${pending.length} payment${pending.length > 1 ? 's' : ''} to confirm. A disbursement run cannot be locked while any are waiting.`}
        {cutover && ` Payments received on or before ${cutover} were disbursed before the FMS started: use “Before cut-over” so they don’t count twice.`}
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Split</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.key}>
                <TableCell className="tabular whitespace-nowrap">{i.date || '—'}</TableCell>
                <TableCell>
                  {i.ref ?? '—'}
                  {i.noRecord && <p className="text-xs text-muted-foreground">Marked paid in the NUC; no payment recorded</p>}
                  {(i.method || i.reference) && <p className="text-xs text-muted-foreground">{[i.method, i.reference].filter(Boolean).join(' · ')}</p>}
                </TableCell>
                <TableCell>{i.student}</TableCell>
                <TableCell>
                  {i.clientId && client.get(i.clientId) ? (
                    <Link to={`/clients/${i.clientId}`} className="underline underline-offset-2">
                      {client.get(i.clientId)!.code}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </TableCell>
                <TableCell className="tabular text-right">{formatKES(i.amount)}</TableCell>
                <TableCell className="tabular text-sm">
                  {i.confirmed ? (
                    <>
                      {i.confirmed.splits.map((s, n) => (
                        <p key={n}>
                          {STREAM_LABEL[s.stream]} {formatKES(s.amount_cents)}
                        </p>
                      ))}
                      {i.confirmed.legacy && <p className="text-xs text-muted-foreground">Before cut-over; not in the Revenue balance</p>}
                    </>
                  ) : (
                    <Badge>To confirm</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!i.confirmed && beforeCutover(i) && (
                    <Button size="sm" variant="outline" className="mr-2" disabled={!i.clientId || markLegacy.isPending} onClick={() => markLegacy.mutate(i)}>
                      Before cut-over
                    </Button>
                  )}
                  {!i.confirmed && (
                    <Button size="sm" variant={beforeCutover(i) ? 'ghost' : 'default'} disabled={!i.clientId} title={i.clientId ? undefined : 'Add this student to a client account first'} onClick={() => setConfirming(i)}>
                      Confirm
                    </Button>
                  )}
                  {i.confirmed?.legacy && !i.confirmed.inRun && (
                    <Button size="sm" variant="ghost" disabled={undoLegacy.isPending} onClick={() => undoLegacy.mutate(i.confirmed!.allocationIds)}>
                      Undo
                    </Button>
                  )}
                  {i.confirmed && !i.confirmed.inRun && i.confirmed.transactionId && (
                    <Button size="sm" variant="ghost" disabled={undo.isPending} onClick={() => undo.mutate(i.confirmed!.transactionId!)}>
                      Undo
                    </Button>
                  )}
                  {i.confirmed?.inRun && <Badge variant="secondary">In a run</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {confirming && <ConfirmDialog item={confirming} onClose={() => setConfirming(null)} />}
    </>
  );
}
