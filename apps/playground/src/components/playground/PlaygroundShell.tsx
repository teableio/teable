import type { ITableDto } from '@teable/v2-contract-http';
import { Link } from '@tanstack/react-router';
import { LayoutGrid, Table as TableIcon, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';

type PlaygroundShellProps = {
  baseId: string;
  activeTableId: string | null;
  tables: ReadonlyArray<ITableDto>;
  isInitialLoading: boolean;
  errorMessage: string | null;
  children: ReactNode;
};

export function PlaygroundShell({
  baseId,
  activeTableId,
  tables,
  isInitialLoading,
  errorMessage,
  children,
}: PlaygroundShellProps) {
  return (
    <SidebarProvider>
      <PlaygroundSidebar
        baseId={baseId}
        activeTableId={activeTableId}
        tables={tables}
        isInitialLoading={isInitialLoading}
        errorMessage={errorMessage}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}

type PlaygroundSidebarProps = {
  baseId: string;
  activeTableId: string | null;
  tables: ReadonlyArray<ITableDto>;
  isInitialLoading: boolean;
  errorMessage: string | null;
};

function PlaygroundSidebar({
  baseId,
  activeTableId,
  tables,
  isInitialLoading,
  errorMessage,
}: PlaygroundSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-4 pt-5 pb-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <LayoutGrid className="h-4 w-4" />
          Tables
        </div>
        <SidebarInput placeholder="Search tables" disabled aria-label="Search tables" />
      </SidebarHeader>
      <SidebarSeparator className="-translate-x-2.5" />
      <SidebarContent className="px-2 pb-4">
        <SidebarGroup>
          <SidebarGroupContent>
            {isInitialLoading ? (
              <SidebarMenu>
                {Array.from({ length: 3 }).map((_, index) => (
                  <SidebarMenuItem key={`table-skeleton-${index}`}>
                    <SidebarMenuSkeleton showIcon />
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : errorMessage ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4" />
                <span>{errorMessage}</span>
              </div>
            ) : tables.length ? (
              <SidebarMenu>
                {tables.map((table) => {
                  const isActive = table.id === activeTableId;
                  return (
                    <SidebarMenuItem key={table.id}>
                      <SidebarMenuButton asChild isActive={isActive} className="gap-3">
                        <Link to="/$baseId/$tableId" params={{ baseId, tableId: table.id }}>
                          <TableIcon className="h-4 w-4" />
                          <span className="flex-1 truncate font-medium">{table.name}</span>
                        </Link>
                      </SidebarMenuButton>
                      <SidebarMenuBadge>{table.fields.length}</SidebarMenuBadge>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            ) : (
              <div className="rounded-lg border border-dashed border-sidebar-border p-4 text-sm text-muted-foreground">
                No tables yet. Create your first one.
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
