import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** Honest empty state for workspaces that are scheduled for a later build phase. */
export function UpcomingPanel({ title, icon: Icon, phase, description }: {
  title: string;
  icon: LucideIcon;
  phase: number;
  description: string;
}) {
  return (
    <>
      <PanelHeader title={title} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-hover text-fg-muted">
          <Icon size={20} strokeWidth={1.75} />
        </div>
        <p className="text-fg-muted">{description}</p>
        <p className="rounded-full border border-edge px-2 py-0.5 text-2xs text-fg-subtle">Planned for phase {phase}</p>
      </div>
    </>
  );
}

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-edge px-3">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
