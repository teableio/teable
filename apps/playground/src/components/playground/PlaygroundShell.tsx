import type { ITableDto } from '@teable/v2-contract-http';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Database,
  LayoutGrid,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
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
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

type PlaygroundShellProps = {
  baseId: string;
  activeTableId: string | null;
  tables: ReadonlyArray<ITableDto>;
  isInitialLoading: boolean;
  errorMessage: string | null;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onDeleteTable: (table: ITableDto) => void;
  isDeletingTable: boolean;
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
  onDeleteTable,
  isDeletingTable,
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
        onDeleteTable={onDeleteTable}
        isDeletingTable={isDeletingTable}
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
  onDeleteTable: (table: ITableDto) => void;
  isDeletingTable: boolean;
};

function PlaygroundSidebar({
  baseId,
  activeTableId,
  tables,
  isInitialLoading,
  errorMessage,
  searchValue,
  onSearchChange,
  onDeleteTable,
  isDeletingTable,
}: PlaygroundSidebarProps) {
  const navigate = useNavigate();
  const [nextBaseId, setNextBaseId] = useState(baseId);
  const [deleteTarget, setDeleteTarget] = useState<ITableDto | null>(null);

  useEffect(() => {
    setNextBaseId(baseId);
  }, [baseId]);

  const trimmedBaseId = nextBaseId.trim();
  const canSwitchBase = trimmedBaseId.length > 0 && trimmedBaseId !== baseId;

  const handleBaseSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSwitchBase) return;
    void navigate({
      to: '/$baseId',
      params: { baseId: trimmedBaseId },
      search: {},
    });
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    onDeleteTable(deleteTarget);
    setDeleteTarget(null);
  };

  return (
    <>
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
                        <SidebarMenuAction
                          showOnHover
                          onClick={() => setDeleteTarget(table)}
                          aria-label={`Delete ${table.name}`}
                          disabled={isDeletingTable}
                        >
                          <Trash2 className="h-4 w-4" />
                        </SidebarMenuAction>
                        <SidebarMenuBadge className="right-7">
                          {table.fields.length}
                        </SidebarMenuBadge>
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
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete table</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete "${deleteTarget.name}"? This will remove its schema and metadata.`
                : 'Delete this table?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingTable}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"
              onClick={handleDeleteConfirm}
              disabled={isDeletingTable}
            >
              {isDeletingTable ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
