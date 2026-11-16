import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase';

interface AuditRow {
  id: number;
  at: string;
  user_id: string | null;
  table_name: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

const IGNORED = new Set(['created_at', 'updated_at', 'created_by', 'updated_by', 'id']);

function describe(row: AuditRow): string {
  if (row.action === 'UPDATE' && row.old_data && row.new_data) {
    const changed = Object.keys(row.new_data).filter(
      (k) => !IGNORED.has(k) && JSON.stringify(row.old_data![k]) !== JSON.stringify(row.new_data![k]),
    );
    return changed.map((k) => `${k}: ${JSON.stringify(row.old_data![k])} → ${JSON.stringify(row.new_data![k])}`).join('; ');
  }
  const data = row.new_data ?? row.old_data ?? {};
  return Object.entries(data)
    .filter(([k, v]) => !IGNORED.has(k) && v !== null)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('; ');
}

const ACTION_LABEL: Record<string, string> = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };

export default function AuditLog() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => {
      const [log, partners] = await Promise.all([
        supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200),
        supabase.from('partners').select('code, user_id'),
      ]);
      if (log.error) throw log.error;
      const who = new Map((partners.data ?? []).map((p) => [p.user_id as string, p.code as string]));
      return { rows: log.data as AuditRow[], who };
    },
  });

  return (
    <>
      <PageHeader title="Audit log" description="Every change made in the system: who, when and what. Latest 200." />
      <Card>
        <CardContent className="pt-6">
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-destructive">{(error as Error).message}</p>}
          {data && data.rows.length === 0 && <p className="text-muted-foreground">No changes recorded yet.</p>}
          {data && data.rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular whitespace-nowrap">
                      {new Date(r.at).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell>{r.user_id ? (data.who.get(r.user_id) ?? 'Unknown') : 'System'}</TableCell>
                    <TableCell>{r.table_name.replace(/_/g, ' ')}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ACTION_LABEL[r.action] ?? r.action}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md break-words text-sm text-muted-foreground">{describe(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
