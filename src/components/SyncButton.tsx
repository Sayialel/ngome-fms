import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { fetchLastSync, syncNow } from '@/lib/nuc';

function when(iso: string) {
  return new Date(iso).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' });
}

export default function SyncButton() {
  const qc = useQueryClient();
  const { data: last } = useQuery({ queryKey: ['last-sync'], queryFn: fetchLastSync });
  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: () => {
      toast.success('Synced with the NUC');
      qc.invalidateQueries();
    },
    onError: (e: Error) => {
      toast.error(`Sync failed: ${e.message}`);
      qc.invalidateQueries({ queryKey: ['last-sync'] });
    },
  });
  return (
    <div className="flex items-center gap-3">
      <p className="text-sm text-muted-foreground">
        {last?.finished_at
          ? last.status === 'ok'
            ? `NUC synced ${when(last.finished_at)}`
            : `Last sync failed ${when(last.finished_at)}: ${last.error}`
          : 'Not synced yet'}
      </p>
      <Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
        <RefreshCw className={`mr-2 h-4 w-4 ${sync.isPending ? 'animate-spin' : ''}`} />
        {sync.isPending ? 'Syncing…' : 'Sync now'}
      </Button>
    </div>
  );
}
