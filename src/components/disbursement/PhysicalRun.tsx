import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { PhysicalSheet } from '@/components/disbursement/RunSheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { rulesOn, type RunData } from '@/lib/disbursement-data';
import { formatKES } from '@/lib/engine/money';
import { buildPhysicalRun } from '@/lib/run';
import { supabase } from '@/lib/supabase';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

export default function PhysicalRun({ data }: { data: RunData }) {
  const qc = useQueryClient();
  const { partner } = useAuth();
  const [runDate, setRunDate] = useState(today());
  const [confirming, setConfirming] = useState(false);
  const rules = rulesOn(data.settings, runDate).physical;
  const build = buildPhysicalRun(data.unrun, runDate, data.clientName, data.invoiceRef, rules);
  const overdue = build.result.entries.filter((e) => e.dueBy < today());
  const ratio = (['JMS', 'EL', 'EW'] as const).map((p) => rules.ratio[p]).join(' : ');

  const lock = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('lock_run', {
        p_zone: 'physical', p_run_date: runDate,
        p_payload: { transfers: build.transfers, allocation_ids: build.allocationIds, settings: rules, result: { ...build.result, extras: { transfers: build.transfers } } },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`Physicals run for ${runDate} locked`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="phy-date">Run date</Label>
        <Input id="phy-date" type="date" value={runDate} onChange={(e) => e.target.value && setRunDate(e.target.value)} className="w-44" />
      </div>
      <p className="text-sm text-muted-foreground">
        Physical-session money is split JMS : EL : EW = {ratio}, with no RE, and is due within {rules.payWithinDays} days of being received. It comes from payments
        confirmed with a “Physical sessions” amount.
      </p>
      {build.result.entries.length === 0 ? (
        <p className="text-muted-foreground">No physical-session money is waiting.</p>
      ) : (
        <>
          {overdue.length > 0 && <p className="text-sm text-negative">{overdue.length} payment{overdue.length > 1 ? 's are' : ' is'} past the {rules.payWithinDays}-day limit.</p>}
          <PhysicalSheet result={build.result} transfers={build.transfers} />
          {build.result.remainder > 0 && <p className="text-sm text-muted-foreground">KES {formatKES(build.result.remainder)} is left in Revenue by rounding down.</p>}
          {!partner?.is_lead && <p className="text-sm text-negative">Only the finance lead can lock a run.</p>}
          <Button disabled={!partner?.is_lead || lock.isPending} onClick={() => setConfirming(true)}>
            <Lock className="mr-2 h-4 w-4" /> Lock physicals run
          </Button>
        </>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock the physicals run for {runDate}?</AlertDialogTitle>
            <AlertDialogDescription>This records KES {formatKES(build.result.total - build.result.remainder)} paid to the partners. A locked run cannot be edited.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => lock.mutate()}>Lock run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
