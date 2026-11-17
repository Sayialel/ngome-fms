import type { ReactNode } from 'react';
import { SpearsMark } from '@/components/Motif';

export default function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-4">
      <div>
        <div className="flex items-center gap-2.5">
          <SpearsMark className="h-7 w-7 text-sidebar-primary" />
          <h1 className="font-display text-3xl font-bold">{title}</h1>
        </div>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
