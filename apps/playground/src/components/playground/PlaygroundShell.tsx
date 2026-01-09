import type { ITableDto } from '@teable/v2-contract-http';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  ChevronDown,
  Database,
  FlaskConical,
  GalleryVerticalEnd,
  Globe,
  Search,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import { useLocalStorage } from 'usehooks-ts';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  usePlaygroundEnvironment,
  resolvePlaygroundEnvironment,
} from '@/lib/playground/environment';
import {
  PLAYGROUND_DB_URL_STORAGE_KEY,
  formatPlaygroundDbUrlLabel,
  isValidPlaygroundDbUrl,
} from '@/lib/playground/databaseUrl';
import { cn } from '@/lib/utils';

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
  const env = usePlaygroundEnvironment();
  const isSandbox = env.kind === 'sandbox';

  return (
    <div
      className={cn(
        'relative min-h-svh bg-background',
        isSandbox &&
          'rounded-2xl ring-2 ring-emerald-400/70 ring-offset-4 ring-offset-emerald-50/50'
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.25]" />
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-56 bg-gradient-radial opacity-80" />
      {isSandbox ? (
        <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2">
          <div className="rounded-b-xl border border-t-0 border-emerald-500/50 bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 px-5 py-1.5 text-[10px] font-bold tracking-[0.3em] text-white shadow-lg shadow-emerald-500/20">
            SANDBOX
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          'relative z-10 min-h-svh bg-background/70 backdrop-blur-sm',
          isSandbox && 'rounded-2xl overflow-hidden'
        )}
      >
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
          <SidebarInset className="h-svh overflow-hidden bg-background/80 backdrop-blur-sm">
            {children}
          </SidebarInset>
        </SidebarProvider>
      </div>
    </div>
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
  const env = usePlaygroundEnvironment();
  const isSandbox = env.kind === 'sandbox';
  const sandboxEnv = resolvePlaygroundEnvironment('/sandbox');
  const remoteEnv = resolvePlaygroundEnvironment('/');
  const activeEnv = isSandbox ? sandboxEnv : remoteEnv;
  const [nextBaseId, setNextBaseId] = useState(baseId);
  const [deleteTarget, setDeleteTarget] = useState<ITableDto | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dbDialogOpen, setDbDialogOpen] = useState(false);
  const [dbDraft, setDbDraft] = useState('');
  const [dbError, setDbError] = useState<string | null>(null);
  const [dbTestStatus, setDbTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const [dbTestMessage, setDbTestMessage] = useState<string | null>(null);
  const [dbUrl, setDbUrl, removeDbUrl] = useLocalStorage<string | null>(
    PLAYGROUND_DB_URL_STORAGE_KEY,
    null,
    { initializeWithValue: false }
  );

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

  useEffect(() => {
    if (!dbDialogOpen) return;
    setDbDraft(dbUrl ?? '');
    setDbError(null);
    setDbTestStatus('idle');
    setDbTestMessage(null);
  }, [dbDialogOpen, dbUrl]);

  useEffect(() => {
    if (!dbDialogOpen) return;
    setDbError(null);
    setDbTestStatus('idle');
    setDbTestMessage(null);
  }, [dbDraft, dbDialogOpen]);

  const trimmedBaseId = nextBaseId.trim();
  const canSwitchBase = trimmedBaseId.length > 0 && trimmedBaseId !== baseId;

  const handleBaseSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSwitchBase) return;
    void navigate({
      to: env.routes.base,
      params: { baseId: trimmedBaseId },
      search: {},
    });
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    onDeleteTable(deleteTarget);
    setDeleteTarget(null);
  };

  const reloadPlayground = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleDbSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = dbDraft.trim();
    if (!trimmed) {
      removeDbUrl();
      setDbDialogOpen(false);
      reloadPlayground();
      return;
    }
    if (!isValidPlaygroundDbUrl(trimmed)) {
      setDbError('Use a postgres:// or postgresql:// URL.');
      return;
    }
    setDbUrl(trimmed);
    setDbDialogOpen(false);
    reloadPlayground();
  };

  const handleDbTest = async () => {
    const trimmed = dbDraft.trim();
    if (!trimmed) {
      setDbTestStatus('error');
      setDbTestMessage('Enter a database URL first.');
      return;
    }
    if (!isValidPlaygroundDbUrl(trimmed)) {
      setDbTestStatus('error');
      setDbTestMessage('Use a postgres:// or postgresql:// URL.');
      return;
    }
    setDbTestStatus('loading');
    setDbTestMessage('Testing connection...');
    try {
      const response = await fetch('/api/db/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connectionString: trimmed }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || payload?.ok === false) {
        const message = payload?.error ?? 'Connection failed.';
        setDbTestStatus('error');
        setDbTestMessage(message);
        return;
      }
      setDbTestStatus('success');
      setDbTestMessage('Connection OK.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed.';
      setDbTestStatus('error');
      setDbTestMessage(message);
    }
  };

  const handleDbClear = () => {
    removeDbUrl();
    setDbDialogOpen(false);
    reloadPlayground();
  };

  const dbLabel = dbUrl ? formatPlaygroundDbUrlLabel(dbUrl) : 'Default (.env)';

  const readStoredValue = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return parsed.trim() || null;
      if (parsed === null || parsed === undefined) return null;
    } catch {
      return raw.trim() || null;
    }
    return null;
  };

  const resolveTargetPath = (target: typeof activeEnv) => {
    if (typeof window === 'undefined') {
      return { to: target.routes.base, params: { baseId: target.defaults.baseId } };
    }
    const storedBaseId = readStoredValue(target.storageKeys.baseId);
    const storedTableId = readStoredValue(target.storageKeys.tableId);
    const baseId = storedBaseId || target.defaults.baseId;
    if (storedTableId) {
      return { to: target.routes.table, params: { baseId, tableId: storedTableId } };
    }
    return { to: target.routes.base, params: { baseId } };
  };

  const handleEnvSwitch = (target: typeof activeEnv) => {
    const next = resolveTargetPath(target);
    void navigate({ ...next, search: {} });
  };

  return (
    <>
      <Sidebar
        collapsible="icon"
        className="border-r border-sidebar-border/70 bg-sidebar/80 backdrop-blur-xl shadow-sm"
      >
        <SidebarHeader className="gap-0 border-b border-sidebar-border/70 bg-sidebar/90 backdrop-blur">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <div className="flex items-center gap-3">
                  <div className="flex aspect-square size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md">
                    <GalleryVerticalEnd className="size-5" />
                  </div>
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="text-sm font-semibold tracking-tight text-foreground">
                      Teable v2
                    </span>
                    <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                      Playground
                    </span>
                  </div>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          <SidebarGroup className="shrink-0 py-2">
            <SidebarGroupLabel className="h-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Base
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <form
                className="flex items-center gap-1.5 px-2 group-data-[collapsible=icon]:hidden"
                onSubmit={handleBaseSubmit}
              >
                <SidebarInput
                  type="text"
                  placeholder="Base ID"
                  value={nextBaseId}
                  onChange={(event) => setNextBaseId(event.target.value)}
                  aria-label="Base ID"
                  spellCheck={false}
                  className="h-8 text-xs bg-background/70 border-border/60 focus:border-primary/40"
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
            <SidebarGroupLabel className="h-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Tables
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <div className="px-2 group-data-[collapsible=icon]:hidden">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <SidebarInput
                    type="search"
                    placeholder="Search tables..."
                    value={searchValue}
                    onChange={(event) => onSearchChange(event.target.value)}
                    maxLength={255}
                    aria-label="Search tables"
                    className="pl-8 bg-background/70 border-border/60 focus:border-primary/40"
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
                    <SidebarMenu className="space-y-1">
                      {tables.map((table) => {
                        const isActive = table.id === activeTableId;
                        return (
                          <SidebarMenuItem key={table.id}>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              size="sm"
                              className={cn(
                                'transition-all duration-200',
                                isActive && 'bg-sidebar-accent/70 border border-sidebar-border/80'
                              )}
                            >
                              <Link
                                to={env.routes.table}
                                params={{ baseId, tableId: table.id }}
                                search={(prev) => ({
                                  ...prev,
                                  ...(searchValue ? { q: searchValue } : {}),
                                })}
                              >
                                <TableIcon
                                  className={cn(
                                    'h-4 w-4 transition-colors',
                                    isActive && 'text-primary'
                                  )}
                                />
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
                            <SidebarMenuBadge className="right-7 text-[10px] font-medium">
                              {table.fields.length}
                            </SidebarMenuBadge>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  ) : (
                    <div className="mx-2 rounded-xl border border-dashed border-sidebar-border/70 bg-gradient-to-br from-muted/40 to-muted/10 p-6 text-center">
                      <div className="mb-2 text-3xl opacity-40">
                        <TableIcon className="mx-auto h-8 w-8" />
                      </div>
                      <p className="text-sm font-medium text-muted-foreground">No tables found</p>
                      <p className="mt-1 text-xs text-muted-foreground/70">
                        Create a table to get started
                      </p>
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
                    tooltip="Environment"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <div
                      className={cn(
                        'flex size-9 items-center justify-center rounded-xl border-2 shadow-sm transition-all duration-200',
                        isSandbox
                          ? 'border-emerald-400/60 bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 text-emerald-600'
                          : 'border-sky-400/60 bg-gradient-to-br from-sky-500/20 to-sky-600/10 text-sky-600'
                      )}
                    >
                      {isSandbox ? (
                        <FlaskConical className="size-5" />
                      ) : (
                        <Globe className="size-5" />
                      )}
                    </div>
                    <div className="flex flex-1 items-center justify-between gap-3 group-data-[collapsible=icon]:hidden">
                      <div className="flex flex-col text-left leading-tight">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          Environment
                        </span>
                        <span className="text-sm font-semibold">
                          {isSandbox ? 'Sandbox' : 'Remote'}
                        </span>
                      </div>
                      <ChevronDown className="size-4 opacity-60" />
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side="top"
                  align="start"
                  sideOffset={6}
                >
                  <DropdownMenuLabel className="text-xs">Switch environment</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="gap-2 py-2 text-sm"
                      onSelect={() => handleEnvSwitch(remoteEnv)}
                      disabled={activeEnv.kind === 'remote'}
                    >
                      <Globe className="mr-2 size-4 text-sky-600" />
                      Remote
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 py-2 text-sm"
                      onSelect={() => handleEnvSwitch(sandboxEnv)}
                      disabled={activeEnv.kind === 'sandbox'}
                    >
                      <FlaskConical className="mr-2 size-4 text-emerald-600" />
                      Sandbox
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Database</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="gap-2 py-2 text-sm"
                      onSelect={() => setDbDialogOpen(true)}
                    >
                      <Database className="mr-2 size-4 text-slate-600" />
                      {dbUrl ? 'Edit database URL' : 'Set database URL'}
                    </DropdownMenuItem>
                    {dbUrl ? (
                      <DropdownMenuItem
                        className="gap-2 py-2 text-sm text-destructive focus:text-destructive"
                        onSelect={handleDbClear}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Clear override
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="text-xs text-muted-foreground/80"
                      disabled
                    >{`Active: ${dbLabel}`}</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <Dialog open={dbDialogOpen} onOpenChange={setDbDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Database URL</DialogTitle>
            <DialogDescription>
              Override the remote playground database connection. Stored locally in your browser and
              applied after reload.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleDbSave}>
            <Input
              type="text"
              placeholder="postgres://user:pass@localhost:5432/teable"
              value={dbDraft}
              onChange={(event) => setDbDraft(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {dbError ? <p className="text-xs text-destructive">{dbError}</p> : null}
            {dbTestMessage ? (
              <p
                className={cn(
                  'text-xs',
                  dbTestStatus === 'success' && 'text-emerald-600',
                  dbTestStatus === 'error' && 'text-destructive',
                  dbTestStatus === 'loading' && 'text-muted-foreground'
                )}
              >
                {dbTestMessage}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDbDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleDbTest}
                disabled={dbTestStatus === 'loading'}
              >
                {dbTestStatus === 'loading' ? 'Testing...' : 'Test connection'}
              </Button>
              <Button type="submit">Save &amp; reload</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
