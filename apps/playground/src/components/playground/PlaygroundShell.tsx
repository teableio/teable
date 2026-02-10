import type { IBaseDto, ITableDto } from '@teable/v2-contract-http';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Cog,
  Copy,
  Database,
  FlaskConical,
  GalleryVerticalEnd,
  Globe,
  Pin,
  Plus,
  Search,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, useRef, type FormEvent, type ReactNode } from 'react';
import { useCopyToClipboard, useLocalStorage } from 'usehooks-ts';
import { toast } from 'sonner';
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
  useSidebar,
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
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  usePlaygroundEnvironment,
  resolvePlaygroundEnvironment,
} from '@/lib/playground/environment';
import {
  PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
  PLAYGROUND_DB_URL_STORAGE_KEY,
  createPlaygroundDbConnectionId,
  findPlaygroundDbConnectionByUrl,
  formatPlaygroundDbUrlLabel,
  isValidPlaygroundDbUrl,
  maskPlaygroundDbUrl,
  normalizePlaygroundDbUrl,
  resolvePlaygroundDbUrl,
  resolvePlaygroundDbStorageKey,
  sortPlaygroundDbConnections,
  type PlaygroundDbConnection,
} from '@/lib/playground/databaseUrl';
import { cn } from '@/lib/utils';

type PlaygroundShellProps = {
  baseId: string;
  bases: ReadonlyArray<IBaseDto>;
  isLoadingBases: boolean;
  onCreateBase: (name: string) => void;
  isCreatingBase: boolean;
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

type DbConnectionDraft = {
  id: string | null;
  name: string;
  description: string;
  url: string;
  pinned: boolean;
};

type NavigationTarget =
  | { to: string; params: { baseId: string } }
  | { to: string; params: { baseId: string; tableId: string } }
  | { to: string; params?: undefined };

export function PlaygroundShell({
  baseId,
  bases,
  isLoadingBases,
  onCreateBase,
  isCreatingBase,
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
            bases={bases}
            isLoadingBases={isLoadingBases}
            onCreateBase={onCreateBase}
            isCreatingBase={isCreatingBase}
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
  bases: ReadonlyArray<IBaseDto>;
  isLoadingBases: boolean;
  onCreateBase: (name: string) => void;
  isCreatingBase: boolean;
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
  bases,
  isLoadingBases,
  onCreateBase,
  isCreatingBase,
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
  const { isMobile, state } = useSidebar();
  const [nextBaseId, setNextBaseId] = useState(baseId);
  const [baseDropdownOpen, setBaseDropdownOpen] = useState(false);
  const [newBaseName, setNewBaseName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ITableDto | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dbManagerOpen, setDbManagerOpen] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState<DbConnectionDraft>({
    id: null,
    name: '',
    description: '',
    url: '',
    pinned: false,
  });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionTestStatus, setConnectionTestStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [connectionTestMessage, setConnectionTestMessage] = useState<string | null>(null);
  const [dbUrl, setDbUrl, removeDbUrl] = useLocalStorage<string | null>(
    PLAYGROUND_DB_URL_STORAGE_KEY,
    null,
    { initializeWithValue: false }
  );
  const [dbConnections, setDbConnections] = useLocalStorage<PlaygroundDbConnection[]>(
    PLAYGROUND_DB_CONNECTIONS_STORAGE_KEY,
    [],
    { initializeWithValue: false }
  );
  const envDbUrl = resolvePlaygroundDbUrl(null);
  const activeDbUrl = resolvePlaygroundDbUrl(dbUrl);
  const [, copyToClipboard] = useCopyToClipboard();

  const resetConnectionDraft = useCallback((connection?: PlaygroundDbConnection) => {
    if (connection) {
      setConnectionDraft({
        id: connection.id,
        name: connection.name,
        description: connection.description ?? '',
        url: connection.url,
        pinned: Boolean(connection.pinned),
      });
    } else {
      setConnectionDraft({
        id: null,
        name: '',
        description: '',
        url: '',
        pinned: false,
      });
    }
    setConnectionError(null);
    setConnectionTestStatus('idle');
    setConnectionTestMessage(null);
  }, []);

  const updateConnectionDraft = (updates: Partial<DbConnectionDraft>) => {
    setConnectionDraft((prev) => ({ ...prev, ...updates }));
    setConnectionError(null);
    setConnectionTestStatus('idle');
    setConnectionTestMessage(null);
  };

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
  }, [activeTableId]);

  useEffect(() => {
    if (!dbManagerOpen) return;
    resetConnectionDraft();
  }, [dbManagerOpen, resetConnectionDraft]);

  const trimmedBaseId = nextBaseId.trim();
  const canSwitchBase = trimmedBaseId.length > 0 && trimmedBaseId !== baseId;
  const tableSkeletonKeys = ['table-skeleton-0', 'table-skeleton-1', 'table-skeleton-2'];

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

  const handleConnectionSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = connectionDraft.name.trim();
    const trimmedUrl = normalizePlaygroundDbUrl(connectionDraft.url);
    const trimmedDescription = connectionDraft.description.trim();

    if (!trimmedName) {
      setConnectionError('Connection name is required.');
      return;
    }
    if (!trimmedUrl) {
      setConnectionError('Enter a database URL first.');
      return;
    }
    if (!isValidPlaygroundDbUrl(trimmedUrl)) {
      setConnectionError('Use a postgres:// or postgresql:// URL.');
      return;
    }

    const now = Date.now();
    const existing = connectionDraft.id
      ? dbConnections.find((item) => item.id === connectionDraft.id)
      : undefined;
    const nextConnection: PlaygroundDbConnection = {
      id: connectionDraft.id ?? createPlaygroundDbConnectionId(),
      name: trimmedName,
      description: trimmedDescription ? trimmedDescription : undefined,
      url: trimmedUrl,
      pinned: connectionDraft.pinned,
      createdAt: existing?.createdAt ?? now,
      lastUsedAt: existing?.lastUsedAt,
    };

    const nextConnections = connectionDraft.id
      ? dbConnections.map((item) => (item.id === connectionDraft.id ? nextConnection : item))
      : [...dbConnections, nextConnection];

    setDbConnections(nextConnections);

    if (
      existing &&
      dbUrl &&
      normalizePlaygroundDbUrl(existing.url) === normalizePlaygroundDbUrl(dbUrl)
    ) {
      if (normalizePlaygroundDbUrl(existing.url) !== normalizePlaygroundDbUrl(nextConnection.url)) {
        setDbUrl(nextConnection.url);
        setDbManagerOpen(false);
        reloadPlayground();
        return;
      }
    }

    resetConnectionDraft();
  };

  const handleConnectionTest = async () => {
    const trimmedUrl = normalizePlaygroundDbUrl(connectionDraft.url);
    if (!trimmedUrl) {
      setConnectionTestStatus('error');
      setConnectionTestMessage('Enter a database URL first.');
      return;
    }
    if (!isValidPlaygroundDbUrl(trimmedUrl)) {
      setConnectionTestStatus('error');
      setConnectionTestMessage('Use a postgres:// or postgresql:// URL.');
      return;
    }
    setConnectionTestStatus('loading');
    setConnectionTestMessage('Testing connection...');
    try {
      const response = await fetch('/api/db/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connectionString: trimmedUrl }),
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!response.ok || payload?.ok === false) {
        const message = payload?.error ?? 'Connection failed.';
        setConnectionTestStatus('error');
        setConnectionTestMessage(message);
        return;
      }
      setConnectionTestStatus('success');
      setConnectionTestMessage('Connection OK.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed.';
      setConnectionTestStatus('error');
      setConnectionTestMessage(message);
    }
  };

  const handleConnectionCopy = useCallback(
    async (connection: PlaygroundDbConnection) => {
      const didCopy = await copyToClipboard(connection.url);
      if (didCopy) {
        toast.success('Database URL copied to clipboard');
      } else {
        toast.error('Failed to copy database URL');
      }
    },
    [copyToClipboard]
  );

  const handleConnectionEdit = (connection: PlaygroundDbConnection) => {
    setDbManagerOpen(true);
    resetConnectionDraft(connection);
  };

  const handleConnectionDelete = (connection: PlaygroundDbConnection) => {
    setDbConnections(dbConnections.filter((item) => item.id !== connection.id));
    if (dbUrl && normalizePlaygroundDbUrl(connection.url) === normalizePlaygroundDbUrl(dbUrl)) {
      void handleUseDefault();
    }
  };

  const handleConnectionSwitch = async (connection: PlaygroundDbConnection) => {
    const now = Date.now();
    setDbConnections(
      dbConnections.map((item) => (item.id === connection.id ? { ...item, lastUsedAt: now } : item))
    );
    setDbUrl(connection.url);
    setDbManagerOpen(false);
    const next = resolveTargetPath(activeEnv, {
      connectionId: connection.id,
      dbUrl: connection.url,
    });
    await navigateToTarget(next);
    reloadPlayground();
  };

  const handleUseDefault = async () => {
    removeDbUrl();
    setDbManagerOpen(false);
    const next = resolveTargetPath(activeEnv, { connectionId: null, dbUrl: null });
    await navigateToTarget(next);
    reloadPlayground();
  };

  const sortedConnections = sortPlaygroundDbConnections(dbConnections);
  const activeConnection = findPlaygroundDbConnectionByUrl(dbConnections, activeDbUrl);
  const dbLabel = dbUrl
    ? activeConnection?.name ?? formatPlaygroundDbUrlLabel(dbUrl)
    : envDbUrl
      ? `Default (.env) - ${activeConnection?.name ?? formatPlaygroundDbUrlLabel(envDbUrl)}`
      : 'Default (.env)';

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

  const resolveStorageKeys = (
    target: typeof activeEnv,
    options: { connectionId?: string | null; dbUrl?: string | null }
  ) => {
    if (target.kind === 'sandbox') {
      return target.storageKeys;
    }
    return {
      baseId: resolvePlaygroundDbStorageKey(target.storageKeys.baseId, options),
      tableId: resolvePlaygroundDbStorageKey(target.storageKeys.tableId, options),
    };
  };

  const resolveTargetPath = (
    target: typeof activeEnv,
    options: { connectionId?: string | null; dbUrl?: string | null }
  ): NavigationTarget => {
    if (typeof window === 'undefined') {
      return { to: target.routes.base, params: { baseId: target.defaults.baseId } };
    }
    const storageKeys = resolveStorageKeys(target, options);
    const storedBaseId = readStoredValue(storageKeys.baseId);
    const storedTableId = readStoredValue(storageKeys.tableId);
    const baseId = storedBaseId || (target.kind === 'sandbox' ? target.defaults.baseId : null);
    if (!baseId) {
      return { to: target.routes.index };
    }
    if (storedTableId) {
      return { to: target.routes.table, params: { baseId, tableId: storedTableId } };
    }
    return { to: target.routes.base, params: { baseId } };
  };

  const navigateToTarget = async (target: NavigationTarget) => {
    if (target.params) {
      await navigate({ to: target.to, params: target.params, search: {} });
      return;
    }
    await navigate({ to: target.to, search: {} });
  };

  const handleEnvSwitch = (target: typeof activeEnv) => {
    const next = resolveTargetPath(target, {
      connectionId: activeConnection?.id ?? null,
      dbUrl: activeDbUrl,
    });
    void navigateToTarget(next);
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
              <div className="px-2 group-data-[collapsible=icon]:hidden space-y-2">
                <DropdownMenu open={baseDropdownOpen} onOpenChange={setBaseDropdownOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between h-8 text-xs bg-background/70 border-border/60"
                      disabled={isLoadingBases}
                    >
                      <span className="truncate">
                        {bases.find((b) => b.id === baseId)?.name ?? baseId}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[220px]" align="start">
                    <DropdownMenuLabel>Switch Base</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <div className="max-h-[200px] overflow-y-auto">
                      <DropdownMenuGroup>
                        {isLoadingBases ? (
                          <DropdownMenuItem disabled>Loading bases...</DropdownMenuItem>
                        ) : bases.length ? (
                          bases.map((base) => (
                            <DropdownMenuItem
                              key={base.id}
                              onSelect={() => {
                                setBaseDropdownOpen(false);
                                void navigate({
                                  to: env.routes.base,
                                  params: { baseId: base.id },
                                  search: {},
                                });
                              }}
                            >
                              <Check
                                className={cn(
                                  'mr-2 h-4 w-4 shrink-0',
                                  baseId === base.id ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              <span className="truncate">{base.name}</span>
                            </DropdownMenuItem>
                          ))
                        ) : (
                          <DropdownMenuItem disabled>No bases found</DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <div className="p-2">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const name = newBaseName.trim();
                            if (name) {
                              onCreateBase(name);
                              setNewBaseName('');
                              setBaseDropdownOpen(false);
                            }
                          }}
                          className="flex items-center gap-1"
                        >
                          <Input
                            type="text"
                            placeholder="New base name"
                            value={newBaseName}
                            onChange={(e) => setNewBaseName(e.target.value)}
                            className="h-7 text-xs"
                            disabled={isCreatingBase}
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 shrink-0"
                            disabled={!newBaseName.trim() || isCreatingBase}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </form>
                      </div>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <form className="flex items-center gap-1.5" onSubmit={handleBaseSubmit}>
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
              </div>
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
                      {tableSkeletonKeys.map((key) => (
                        <SidebarMenuItem key={key}>
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
              <SidebarMenuButton asChild size="lg" tooltip="Computed Tasks">
                <Link to="/computed-tasks">
                  <div className="flex size-9 items-center justify-center rounded-xl border-2 border-orange-400/60 bg-gradient-to-br from-orange-500/20 to-orange-600/10 text-orange-600 shadow-sm">
                    <Cog className="size-5" />
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-3 group-data-[collapsible=icon]:hidden">
                    <div className="flex flex-col text-left leading-tight">
                      <span className="text-[11px] font-medium text-muted-foreground">System</span>
                      <span className="text-sm font-semibold">Computed Tasks</span>
                    </div>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton
                        size="lg"
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
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    align="center"
                    hidden={state !== 'collapsed' || isMobile}
                  >
                    Environment
                  </TooltipContent>
                </Tooltip>
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
                      onSelect={() => setDbManagerOpen(true)}
                    >
                      <Database className="mr-2 size-4 text-slate-600" />
                      Manage connections
                    </DropdownMenuItem>
                    {dbUrl ? (
                      <DropdownMenuItem
                        className="gap-2 py-2 text-sm text-destructive focus:text-destructive"
                        onSelect={handleUseDefault}
                      >
                        <Trash2 className="mr-2 size-4" />
                        Use default (.env)
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs">Saved connections</DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {sortedConnections.length ? (
                      sortedConnections.map((connection) => {
                        const isActive = activeConnection?.id === connection.id;
                        return (
                          <DropdownMenuItem
                            key={connection.id}
                            className="gap-2 py-2 text-sm"
                            onSelect={() => handleConnectionSwitch(connection)}
                            disabled={isActive}
                          >
                            <Check
                              className={cn(
                                'size-4 transition-opacity',
                                isActive ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <span className="flex-1 truncate">{connection.name}</span>
                            {connection.pinned ? (
                              <Pin className="size-3 text-muted-foreground" />
                            ) : null}
                          </DropdownMenuItem>
                        );
                      })
                    ) : (
                      <DropdownMenuItem className="text-xs text-muted-foreground/80" disabled>
                        No saved connections yet
                      </DropdownMenuItem>
                    )}
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
      <Dialog open={dbManagerOpen} onOpenChange={setDbManagerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Database connections</DialogTitle>
            <DialogDescription>
              Store multiple database URLs locally, switch quickly, and reload the playground when
              needed.
              <span className="mt-1 block text-[11px] text-muted-foreground">
                Default (.env):{' '}
                <span className="font-mono">
                  {envDbUrl ? maskPlaygroundDbUrl(envDbUrl) : 'not set'}
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <form
              className="space-y-3 rounded-lg border border-border/60 p-4"
              onSubmit={handleConnectionSave}
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">
                    {connectionDraft.id ? 'Edit connection' : 'New connection'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connectionDraft.id
                      ? 'Update name, description, or URL.'
                      : 'Add a connection saved in this browser.'}
                  </p>
                </div>
                {connectionDraft.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => resetConnectionDraft()}
                  >
                    New
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="playground-db-name">Name</Label>
                  <Input
                    id="playground-db-name"
                    type="text"
                    placeholder="Staging database"
                    value={connectionDraft.name}
                    onChange={(event) => updateConnectionDraft({ name: event.target.value })}
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="playground-db-description">Description</Label>
                  <Textarea
                    id="playground-db-description"
                    placeholder="Optional notes about this connection"
                    value={connectionDraft.description}
                    onChange={(event) => updateConnectionDraft({ description: event.target.value })}
                    rows={2}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="playground-db-url">Database URL</Label>
                  <Input
                    id="playground-db-url"
                    type="text"
                    placeholder="postgres://user:pass@localhost:5432/teable"
                    value={connectionDraft.url}
                    onChange={(event) => updateConnectionDraft({ url: event.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id="playground-db-pin"
                    checked={connectionDraft.pinned}
                    onCheckedChange={(checked) => updateConnectionDraft({ pinned: checked })}
                  />
                  <Label htmlFor="playground-db-pin">Pin to top</Label>
                </div>
              </div>
              {connectionError ? (
                <p className="text-xs text-destructive">{connectionError}</p>
              ) : null}
              {connectionTestMessage ? (
                <p
                  className={cn(
                    'text-xs',
                    connectionTestStatus === 'success' && 'text-emerald-600',
                    connectionTestStatus === 'error' && 'text-destructive',
                    connectionTestStatus === 'loading' && 'text-muted-foreground'
                  )}
                >
                  {connectionTestMessage}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDbManagerOpen(false)}>
                  Close
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleConnectionTest}
                  disabled={connectionTestStatus === 'loading'}
                >
                  {connectionTestStatus === 'loading' ? 'Testing...' : 'Test connection'}
                </Button>
                <Button type="submit">
                  {connectionDraft.id ? 'Save changes' : 'Add connection'}
                </Button>
              </DialogFooter>
            </form>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Saved connections</p>
                  <p className="text-xs text-muted-foreground">Switching reloads the playground.</p>
                </div>
                <Badge variant="secondary">{sortedConnections.length}</Badge>
              </div>
              {sortedConnections.length ? (
                <div className="space-y-2">
                  {sortedConnections.map((connection) => {
                    const isActive = activeConnection?.id === connection.id;
                    return (
                      <div
                        key={connection.id}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{connection.name}</span>
                            {connection.pinned ? (
                              <Pin className="h-3 w-3 text-muted-foreground" />
                            ) : null}
                            {isActive ? <Badge variant="outline">Active</Badge> : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {connection.description || formatPlaygroundDbUrlLabel(connection.url)}
                          </p>
                          <p className="text-[11px] text-muted-foreground/70">
                            {maskPlaygroundDbUrl(connection.url)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleConnectionSwitch(connection)}
                            disabled={isActive}
                          >
                            Use
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleConnectionCopy(connection)}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" />
                            Copy URL
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleConnectionEdit(connection)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => handleConnectionDelete(connection)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground">
                  No saved connections yet.
                </div>
              )}
            </div>
          </div>
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
