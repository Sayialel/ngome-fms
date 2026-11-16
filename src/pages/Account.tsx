import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export default function Account() {
  const { session, partner } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const problem = password.length > 0 && password.length < 12 ? 'Use at least 12 characters' : confirm && confirm !== password ? 'The two passwords do not match' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Password changed');
    setPassword('');
    setConfirm('');
  }

  return (
    <>
      <PageHeader title="My account" description={`${partner?.full_name} · ${session?.user.email}`} />
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new">New password</Label>
              <Input id="new" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Repeat new password</Label>
              <Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {problem && <p className="text-sm text-destructive">{problem}</p>}
            <Button type="submit" disabled={busy || !!problem || !password || password !== confirm}>
              {busy ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
