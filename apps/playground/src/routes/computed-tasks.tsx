import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, Cog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ComputedTasksPanel } from '@/components/playground/ComputedTasksPanel';

export const Route = createFileRoute('/computed-tasks')({
  component: ComputedTasksPage,
});

function ComputedTasksPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full min-h-svh bg-background">
      <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.25]" />
      <header className="relative flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-5 py-4 backdrop-blur">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-muted/35 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.2]" />
        <div className="relative flex w-full flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Playground
              </Link>
            </Button>
            <div className="h-6 w-px bg-gradient-to-b from-transparent via-border to-transparent" />
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-500/5 ring-1 ring-orange-500/20">
                <Cog className="h-4 w-4 text-orange-600" />
              </div>
              <span className="text-base font-semibold tracking-tight">Computed Tasks</span>
            </div>
          </div>
        </div>
      </header>
      <div className="relative flex-1 min-h-0 p-6 overflow-auto">
        <ComputedTasksPanel />
      </div>
    </div>
  );
}
