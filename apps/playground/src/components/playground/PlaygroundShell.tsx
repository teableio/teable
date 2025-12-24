import type { ITableDto } from '@teable/v2-contract-http';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  GalleryVerticalEnd,
  LogOut,
  MoreVertical,
  Search,
  Settings,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
      <SidebarInset className="h-svh overflow-hidden">{children}</SidebarInset>
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNextBaseId(baseId);
  }, [baseId]);

  useEffect(() => {
    if (activeTableId && menuRef.current) {
      const activeElement = menuRef.current.querySelector('[data-active="true"]');
      activeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeTableId, tables]);

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
        <SidebarHeader className="gap-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <div className="flex items-center gap-2">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <GalleryVerticalEnd className="size-4" />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold text-sm">Teable v2</span>
                    <span className="text-[10px] text-muted-foreground">Playground</span>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroup className="shrink-0 py-2">
            <SidebarGroupLabel className="h-6">Base</SidebarGroupLabel>
            <SidebarGroupContent>
              <form className="flex items-center gap-1.5 px-2" onSubmit={handleBaseSubmit}>
                <SidebarInput
                  type="text"
                  placeholder="Base ID"
                  value={nextBaseId}
                  onChange={(event) => setNextBaseId(event.target.value)}
                  aria-label="Base ID"
                  spellCheck={false}
                  className="h-8 text-xs"
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="icon-sm"
                  className="h-8 w-8 shrink-0"
                  disabled={!canSwitchBase}
                  aria-label="Open base"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="shrink-0 pb-4">
            <SidebarGroupLabel className="h-6">Tables</SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <SidebarInput
                    type="search"
                    placeholder="Search tables..."
                    value={searchValue}
                    onChange={(event) => onSearchChange(event.target.value)}
                    maxLength={255}
                    aria-label="Search tables"
                    className="pl-8"
                  />
                </div>
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          <ScrollArea className="h-full" scrollHideDelay={0}>
            <SidebarGroup className="py-2">
              <SidebarGroupContent>
                <div className="mt-2" ref={menuRef}>
                  {isInitialLoading ? (
                    <SidebarMenu>
                      {Array.from({ length: 3 }).map((_, index) => (
                        <SidebarMenuItem key={`table-skeleton-${index}`}>
                          <SidebarMenuSkeleton showIcon />
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  ) : errorMessage ? (
                    <div className="mx-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                      <TriangleAlert className="mt-0.5 h-4 w-4" />
                      <span>{errorMessage}</span>
                    </div>
                  ) : tables.length ? (
                    <SidebarMenu>
                      {tables.map((table) => {
                        const isActive = table.id === activeTableId;
                        return (
                          <SidebarMenuItem key={table.id}>
                            <SidebarMenuButton asChild isActive={isActive} size="sm">
                              <Link
                                to="/$baseId/$tableId"
                                params={{ baseId, tableId: table.id }}
                                search={searchValue ? { q: searchValue } : {}}
                              >
                                <TableIcon className="h-4 w-4" />
                                <span className="truncate">{table.name}</span>
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
                    <div className="mx-2 rounded-lg border border-dashed border-sidebar-border p-4 text-sm text-muted-foreground text-center">
                      No tables found.
                    </div>
                  )}
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </ScrollArea>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                      <User className="size-4" />
                    </div>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">Teable v2</span>
                      <span className="truncate text-xs text-muted-foreground">demo@teable.io</span>
                    </div>
                    <MoreVertical className="ml-auto size-4" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side="bottom"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                        <User className="size-4" />
                      </div>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-semibold">Teable v2</span>
                        <span className="truncate text-xs text-muted-foreground">
                          demo@teable.io
                        </span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem>
                      <Settings className="mr-2 size-4" />
                      Settings
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <LogOut className="mr-2 size-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
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
