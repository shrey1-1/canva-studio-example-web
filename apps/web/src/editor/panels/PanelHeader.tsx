import type { ReactNode } from 'react';

export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-edge px-3">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}
