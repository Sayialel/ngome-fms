/* eslint-disable @typescript-eslint/no-explicit-any -- setting values are JSON whose shape depends on the setting kind; validateSetting checks them before saving */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  fetchSettings,
  formatSetting,
  groupSettings,
  PARTNER_CODES,
  SETTINGS,
  validateSetting,
  type SettingMeta,
  type SettingRow,
} from '@/lib/settings';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });

function ValueEditor({ meta, value, onChange }: { meta: SettingMeta; value: any; onChange: (v: any) => void }) {
  const num = (v: string) => (v === '' ? NaN : Number(v));
  switch (meta.kind) {
    case 'date':
      return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'percent':
    case 'days':
    case 'day_of_month':
      return <Input type="number" value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(num(e.target.value))} />;
    case 'kes':
      return (
        <Input
          type="number"
          step="0.01"
          value={Number.isNaN(value) ? '' : value / 100}
          onChange={(e) => onChange(Math.round(num(e.target.value) * 100))}
        />
      );
    case 'rounding':
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cent">Down to the cent</SelectItem>
            <SelectItem value="shilling">Down to the whole shilling</SelectItem>
          </SelectContent>
        </Select>
      );
    case 'run_days':
      return (
        <Input
          value={(value as string[]).join(', ')}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case 'ratio':
      return (
        <div className="grid grid-cols-3 gap-2">
          {PARTNER_CODES.map((p) => (
            <div key={p}>
              <Label className="text-xs">{p}</Label>
              <Input type="number" value={Number.isNaN(value[p]) ? '' : value[p]} onChange={(e) => onChange({ ...value, [p]: num(e.target.value) })} />
            </div>
          ))}
        </div>
      );
    case 'shares':
      return (
        <div className="space-y-2">
          {PARTNER_CODES.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <Label className="w-10">{p}</Label>
              <Input
                type="number"
                value={Number.isNaN(value[p].num) ? '' : value[p].num}
                onChange={(e) => onChange({ ...value, [p]: { ...value[p], num: num(e.target.value) } })}
              />
              <span>/</span>
              <Input
                type="number"
                value={Number.isNaN(value[p].den) ? '' : value[p].den}
                onChange={(e) => onChange({ ...value, [p]: { ...value[p], den: num(e.target.value) } })}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Enter each share as a fraction, e.g. 13/30, so the split is exact.</p>
        </div>
      );
  }
}

function ChangeDialog({ meta, current, onClose }: { meta: SettingMeta; current: SettingRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState<any>(current.value);
  const [from, setFrom] = useState(today());
  const [note, setNote] = useState('');
  const error = validateSetting(meta.kind, value);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('settings')
        .upsert({ key: meta.key, value, effective_from: from, note: note || null }, { onConflict: 'key,effective_from' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${meta.label} updated from ${from}`);
      qc.invalidateQueries({ queryKey: ['settings'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change: {meta.label}</DialogTitle>
          <DialogDescription>
            The new value applies from the date you choose. Runs dated before it keep the old value.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New value</Label>
            <ValueEditor meta={meta} value={value} onChange={setValue} />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="from">Applies from</Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Reason (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Agreed at partners' meeting" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!error || !from || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  const { partner } = useAuth();
  const { data, isLoading, error } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [editing, setEditing] = useState<{ meta: SettingMeta; current: SettingRow } | null>(null);
  const grouped = groupSettings(data ?? [], today());

  return (
    <>
      <PageHeader
        title="Settings"
        description="Every rate and rule the system uses. Changes take a start date and never alter past runs."
      />
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {!partner?.is_lead && <p className="mb-4 text-sm text-muted-foreground">Only the finance lead can change settings.</p>}

      {(['Disbursement', 'Billing'] as const).map((group) => (
        <Card key={group} className="mb-6">
          <CardHeader>
            <CardTitle className="text-xl">{group}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {SETTINGS.filter((m) => m.group === group).map((meta) => {
              const g = grouped.get(meta.key)!;
              if (!g.current) return null;
              return (
                <div key={meta.key} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{meta.label}</p>
                    <p className="tabular mt-0.5">{formatSetting(meta.kind, g.current.value)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {meta.help} In force since {g.current.effective_from}.
                    </p>
                    {g.scheduled.map((s) => (
                      <p key={s.id} className="mt-1 text-sm">
                        <Badge variant="secondary">From {s.effective_from}</Badge> {formatSetting(meta.kind, s.value)}
                      </p>
                    ))}
                    {g.history.length > 0 && (
                      <details className="mt-1 text-sm text-muted-foreground">
                        <summary className="cursor-pointer">Earlier values ({g.history.length})</summary>
                        {g.history.map((h) => (
                          <p key={h.id} className="tabular mt-1">
                            {h.effective_from}: {formatSetting(meta.kind, h.value)}
                          </p>
                        ))}
                      </details>
                    )}
                  </div>
                  {partner?.is_lead && (
                    <Button variant="outline" size="sm" onClick={() => setEditing({ meta, current: g.current! })}>
                      Change
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {editing && <ChangeDialog meta={editing.meta} current={editing.current} onClose={() => setEditing(null)} />}
    </>
  );
}
