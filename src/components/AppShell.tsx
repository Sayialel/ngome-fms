import { NavLink, Outlet } from 'react-router-dom';
import { Archive, ArrowLeftRight, History, KeyRound, Landmark, LogOut, Settings as SettingsIcon, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import logo from '@/assets/brand/logo-white.png';
import { MotifPattern } from '@/components/Motif';

const NAV = [
  { to: '/clients', label: 'Client Accounts', icon: Users },
  { to: '/internal', label: 'Internal Accounts', icon: Landmark },
  { to: '/disbursement', label: 'Disbursement', icon: ArrowLeftRight },
];

const ADMIN = [
  { to: '/history', label: 'History from Notion', icon: Archive },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
  { to: '/audit', label: 'Audit log', icon: History },
  { to: '/account', label: 'My account', icon: KeyRound },
];

function NavItem({ to, label, icon: Icon }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-sidebar-accent text-sidebar-primary font-medium'
            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

export default function AppShell() {
  const { partner, signOut } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="relative hidden w-60 shrink-0 flex-col overflow-hidden bg-sidebar p-4 md:flex">
        <MotifPattern opacity={0.06} />
        <div className="relative mb-8 px-2">
          <img src={logo} alt="Ngome" className="h-7" />
          <p className="mt-1 text-xs uppercase tracking-[0.25em] text-sidebar-primary">Finance</p>
        </div>
        <nav className="relative space-y-1">
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="relative my-4 h-px bg-gradient-to-r from-transparent via-sidebar-primary/40 to-transparent" />
        <nav className="relative space-y-1">
          {ADMIN.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="relative mt-auto rounded-md border-l-2 border-sidebar-primary bg-sidebar-accent p-3 text-sm text-sidebar-foreground">
          <p className="font-medium">{partner?.full_name}</p>
          <p className="text-xs text-sidebar-foreground/60">
            {partner?.code}
            {partner?.is_lead ? ' · Finance lead' : ''}
          </p>
          <button onClick={signOut} className="mt-2 flex items-center gap-1.5 text-xs text-sidebar-primary hover:underline">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact nav for small screens */}
        <nav className="flex gap-1 overflow-x-auto bg-sidebar p-2 md:hidden">
          {[...NAV, ...ADMIN].map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
