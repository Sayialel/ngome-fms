import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import AppShell from '@/components/AppShell';
import Login from '@/pages/Login';
import NotAPartner from '@/pages/NotAPartner';
import ClientAccounts from '@/pages/ClientAccounts';
import ClientDetail from '@/pages/ClientDetail';
import InternalAccounts from '@/pages/InternalAccounts';
import Disbursement from '@/pages/Disbursement';
import Settings from '@/pages/Settings';
import AuditLog from '@/pages/AuditLog';
import Account from '@/pages/Account';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

function Gate() {
  const { loading, session, partner } = useAuth();
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <Login />;
  if (!partner) return <NotAPartner />;
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/clients" replace />} />
        <Route path="/clients" element={<ClientAccounts />} />
        <Route path="/clients/:id" element={<ClientDetail />} />
        <Route path="/internal" element={<InternalAccounts />} />
        <Route path="/disbursement" element={<Disbursement />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/account" element={<Account />} />
        <Route path="*" element={<Navigate to="/clients" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </AuthProvider>
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
