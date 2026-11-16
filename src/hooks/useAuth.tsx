import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface Partner {
  id: string;
  code: 'JMS' | 'EL' | 'EW';
  full_name: string;
  is_lead: boolean;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  /** The partner linked to this login; null when signed in but not a partner. */
  partner: Partner | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPartner() {
      if (!session) {
        setPartner(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      const { data } = await supabase
        .from('partners')
        .select('id, code, full_name, is_lead')
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (!cancelled) {
        setPartner((data as Partner | null) ?? null);
        setLoading(false);
      }
    }
    loadPartner();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return <AuthContext.Provider value={{ loading, session, partner, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
