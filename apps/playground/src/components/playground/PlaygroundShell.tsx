import type { ITableDto } from '@teable/v2-contract-http';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Database, LayoutGrid, Table as TableIcon, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

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
import { Button } from '@/components/ui/button';

type PlaygroundShellProps = {
  baseId: string;
  activeTableId: string | null;
  tables: ReadonlyArray<ITableDto>;
  isInitialLoading: boolean;
  errorMessage: string | null;
  searchValue: string;
  onSearchChange: (value: string) => void;
  children: ReactNode;
};

export function PlaygroundShell({
  baseId,
  activeTableId,
  tables,
  isInitialLoading,
  errorMessage,
  searchValue,
  onSearchChange,
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
        searchValue={searchValue}
        onSearchChange={onSearchChange}
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
  searchValue: string;
  onSearchChange: (value: string) => void;
};

function PlaygroundSidebar({
  baseId,
  activeTableId,
  tables,
  isInitialLoading,
  errorMessage,
  searchValue,
  onSearchChange,
}: PlaygroundSidebarProps) {
  const navigate = useNavigate();
  const [nextBaseId, setNextBaseId] = useState(baseId);

  useEffect(() => {
    setNextBaseId(baseId);
  }, [baseId]);

  const trimmedBaseId = nextBaseId.trim();
  const canSwitchBase = trimmedBaseId.length > 0 && trimmedBaseId !== baseId;

  const handleBaseSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSwitchBase) return;
    onSearchChange('');
    void navigate({
      to: '/$baseId',
      params: { baseId: trimmedBaseId },
      search: {},
    });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-4 pt-5 pb-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <Database className="h-4 w-4" />
          Base
        </div>
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          onSubmit={handleBaseSubmit}
        >
          <SidebarInput
            type="text"
            placeholder="Base ID"
            value={nextBaseId}
            onChange={(event) => setNextBaseId(event.target.value)}
            aria-label="Base ID"
            spellCheck={false}
          />
          <Button
            type="submit"
            variant="outline"
            size="icon-sm"
            disabled={!canSwitchBase}
            aria-label="Open base"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          <LayoutGrid className="h-4 w-4" />
          Tables
        </div>
        <SidebarInput
          type="search"
          placeholder="Search tables"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          maxLength={255}
          aria-label="Search tables"
        />
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
                        <Link
                          to="/$baseId/$tableId"
                          params={{ baseId, tableId: table.id }}
                          search={searchValue ? { q: searchValue } : {}}
                        >
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
