import { mapTableToDto, type ITableDto } from '@teable/v2-contract-http';
import type { Field, Table as TableAggregate, View, ViewColumnMetaValue } from '@teable/v2-core';
import type { TableTemplateDefinition } from '@teable/v2-table-templates';
import {
  Copy,
  Database,
  FileJson,
  MoreVertical,
  Pencil,
  RefreshCcw,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';
import { JsonView } from 'react-json-view-lite';
import { toast } from 'sonner';
import { useCopyToClipboard } from 'usehooks-ts';

import { CreateTableDropdown } from '@/components/playground/CreateTableDropdown';
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
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { renderFieldOptions } from './fieldOptionsVisitor';

const formatViewLabel = (view: View): string =>
  `${view.name().toString()} (${view.type().toString()})`;

const getViewColumnMeta = (
  view: View
): { value: ViewColumnMetaValue | null; error: string | null } => {
  const result = view.columnMeta();
  if (result.isOk()) {
    return { value: result.value.toDto(), error: null };
  }
  return { value: null, error: result.error };
};

const sortColumnMeta = (
  columnMeta: ViewColumnMetaValue
): Array<[string, ViewColumnMetaValue[string]]> =>
  Object.entries(columnMeta).sort(([, left], [, right]) => (left.order ?? 0) - (right.order ?? 0));

const formatOptionalBoolean = (value: boolean | undefined): string => {
  if (value === undefined) return '-';
  return value ? 'true' : 'false';
};

const formatOptionalNumber = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return value.toString();
};

const formatOptionalString = (value: string | null | undefined): string => {
  if (value === undefined || value === null) return '-';
  return value;
};

const formatColumnMetaExtras = (entry: ViewColumnMetaValue[string]): string => {
  const knownKeys = new Set(['order', 'visible', 'hidden', 'required', 'width', 'statisticFunc']);
  const extra = Object.keys(entry).reduce<Record<string, unknown>>((acc, key) => {
    if (!knownKeys.has(key)) {
      acc[key] = entry[key];
    }
    return acc;
  }, {});

  if (!Object.keys(extra).length) return '-';
  return JSON.stringify(extra);
};

const getDbFieldName = (field: Field): string | null => {
  const nameResult = field.dbFieldName().andThen((name) => name.value());
  return nameResult.isOk() ? nameResult.value : null;
};

const getDbTableName = (table: TableAggregate): string | null => {
  const nameResult = table.dbTableName().andThen((name) => name.value());
  return nameResult.isOk() ? nameResult.value : null;
};

const tableTabValues = ['table', 'json'] as const;
type TableMetaTab = (typeof tableTabValues)[number];

const isTableMetaTab = (value: string): value is TableMetaTab =>
  tableTabValues.includes(value as TableMetaTab);

const shouldExpandJsonNode = (level: number) => level < 2;

const copyTableJson = async (
  table: TableAggregate,
  copyToClipboard: (value: string) => Promise<boolean>
) => {
  const tableDtoResult = mapTableToDto(table);
  if (tableDtoResult.isErr()) {
    toast.error('Unable to prepare table JSON', { description: tableDtoResult.error });
    return;
  }

  const didCopy = await copyToClipboard(JSON.stringify(tableDtoResult.value, null, 2));
  if (didCopy) {
    toast.success('Copied table JSON');
  } else {
    toast.error('Copy failed');
  }
};

type TableMetaPageProps = {
  baseId: string;
  baseName: string;
  tableId: string;
  table: TableAggregate | null;
  eventCount: number | null;
  isInitialLoading: boolean;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
};

export function TableMetaPage({
  baseId,
  baseName,
  tableId,
  table,
  eventCount,
  isInitialLoading,
  isLoading,
  isCreating,
  isDeleting,
  isRenaming,
  errorMessage,
  onRefresh,
  templates,
  onCreateTemplate,
  onDelete,
  onRename,
}: TableMetaPageProps) {
  const [activeTab, setActiveTab] = useQueryState(
    'tab',
    parseAsStringEnum<TableMetaTab>([...tableTabValues]).withDefault('table')
  );
  const tableDtoResult = useMemo(() => (table ? mapTableToDto(table) : null), [table]);
  const tableJson = tableDtoResult?.isOk() ? tableDtoResult.value : null;
  const tableJsonError = tableDtoResult?.isErr() ? tableDtoResult.error : null;

  const handleTabChange = (value: string) => {
    if (!isTableMetaTab(value)) return;
    void setActiveTab(value);
  };

  return (
    <>
      <PlaygroundHeader
        baseName={baseName}
        eventCount={eventCount}
        table={table}
        isLoading={isLoading}
        isCreating={isCreating}
        isDeleting={isDeleting}
        isRenaming={isRenaming}
        onRefresh={onRefresh}
        templates={templates}
        onCreateTemplate={onCreateTemplate}
        onDelete={onDelete}
        onRename={onRename}
      />
      <section className="flex-1 space-y-6 px-6 py-8">
        {errorMessage ? <PlaygroundErrorState message={errorMessage} /> : null}

        {isInitialLoading ? (
          <PlaygroundLoadingState />
        ) : !table ? (
          <PlaygroundEmptyState
            isCreating={isCreating}
            templates={templates}
            onCreateTemplate={onCreateTemplate}
          />
        ) : (
          <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
            <TabsList className="w-fit">
              <TabsTrigger value="table">Table</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            <TabsContent value="table" className="mt-0">
              <PlaygroundMetaLayout
                table={table}
                baseId={baseId}
                tableId={tableId}
                isLoading={isLoading}
              />
            </TabsContent>
            <TabsContent value="json" className="mt-0">
              <PlaygroundJsonLayout
                table={table}
                tableJson={tableJson}
                tableJsonError={tableJsonError}
                baseId={baseId}
                tableId={tableId}
                isLoading={isLoading}
              />
            </TabsContent>
          </Tabs>
        )}
      </section>
    </>
  );
}

type PlaygroundHeaderProps = {
  baseName: string;
  eventCount: number | null;
  table: TableAggregate | null;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  onRefresh: () => void;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
};

function PlaygroundHeader({
  baseName,
  eventCount,
  table,
  isLoading,
  isCreating,
  isDeleting,
  isRenaming,
  onRefresh,
  templates,
  onCreateTemplate,
  onDelete,
  onRename,
}: PlaygroundHeaderProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const canDelete = !!table && !isDeleting;
  const currentName = table ? table.name().toString() : '';
  const trimmedRename = renameValue.trim();
  const canRename =
    !!table && trimmedRename.length > 0 && trimmedRename !== currentName && !isRenaming;

  const handleDeleteConfirm = () => {
    if (!table) return;
    onDelete();
    setDeleteOpen(false);
  };

  const handleRenameConfirm = () => {
    if (!table) return;
    if (!canRename) return;
    onRename(trimmedRename);
    setRenameOpen(false);
  };

  useEffect(() => {
    if (!renameOpen) return;
    if (!table) return;
    setRenameValue(table.name().toString());
  }, [renameOpen, table]);

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-6 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <SidebarTrigger className="shrink-0" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Base
          </div>
          <div className="text-xl font-semibold text-foreground">{baseName}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-4 w-4 text-muted-foreground" />
            <span>Postgres playground</span>
            {eventCount !== null ? <Badge variant="outline">events {eventCount}</Badge> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={!table || isLoading} onClick={onRefresh}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
          align="end"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Table actions" disabled={!table}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!table || isRenaming}
              onSelect={(event) => {
                event.preventDefault();
                setRenameOpen(true);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename table
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={!canDelete}
              onSelect={(event) => {
                event.preventDefault();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete table</AlertDialogTitle>
            <AlertDialogDescription>
              {table
                ? `Delete "${table.name().toString()}"? This will remove its schema and metadata.`
                : 'Delete this table?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Rename table</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a new name for this table. Names must be between 1 and 255 characters.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={255}
              placeholder="Table name"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRenaming}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRenameConfirm} disabled={!canRename}>
              {isRenaming ? 'Renaming...' : 'Rename'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

type PlaygroundErrorStateProps = {
  message: string;
};

function PlaygroundErrorState({ message }: PlaygroundErrorStateProps) {
  return (
    <Card className="border-destructive/40 bg-destructive/10">
      <CardHeader className="flex flex-row items-center gap-3">
        <TriangleAlert className="h-4 w-4 text-destructive" />
        <CardTitle className="text-base text-destructive">{message}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function PlaygroundLoadingState() {
  return (
    <div className="grid gap-6 2xl:grid-cols-[1.25fr_0.75fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-lg">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`header-skeleton-${index}`} className="h-4 w-full" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, rowIndex) => (
              <div key={`row-skeleton-${rowIndex}`} className="grid grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, colIndex) => (
                  <Skeleton key={`cell-skeleton-${rowIndex}-${colIndex}`} className="h-4 w-full" />
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Views</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`connection-skeleton-${index}`} className="flex items-center gap-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="ml-auto h-4 w-32" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type PlaygroundEmptyStateProps = {
  isCreating: boolean;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (template: TableTemplateDefinition) => void;
};

function PlaygroundEmptyState({
  isCreating,
  templates,
  onCreateTemplate,
}: PlaygroundEmptyStateProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Build a table in seconds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          This playground uses Teable v2 core with a fixed actor. Pick a template to create a table,
          view its schema, or switch the base ID from the sidebar.
        </p>
        <CreateTableDropdown
          templates={templates}
          isCreating={isCreating}
          onSelect={onCreateTemplate}
          label="Create table"
          align="start"
        />
      </CardContent>
    </Card>
  );
}

type PlaygroundMetaLayoutProps = {
  table: TableAggregate;
  baseId: string;
  tableId: string;
  isLoading: boolean;
};

function PlaygroundMetaLayout({ table, baseId, tableId, isLoading }: PlaygroundMetaLayoutProps) {
  return (
    <div className="grid gap-6 2xl:grid-cols-[1.25fr_0.75fr]">
      <TableSchemaCard table={table} />
      <div className="space-y-6">
        <TableViewsCard views={table.views()} />
        <TableConnectionCard
          baseId={baseId}
          tableId={tableId}
          table={table}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

type PlaygroundJsonLayoutProps = {
  table: TableAggregate;
  tableJson: ITableDto | null;
  tableJsonError: string | null;
  baseId: string;
  tableId: string;
  isLoading: boolean;
};

function PlaygroundJsonLayout({
  table,
  tableJson,
  tableJsonError,
  baseId,
  tableId,
  isLoading,
}: PlaygroundJsonLayoutProps) {
  return (
    <div className="grid gap-6 2xl:grid-cols-[1.25fr_0.75fr]">
      <TableJsonCard table={table} tableJson={tableJson} tableJsonError={tableJsonError} />
      <div className="space-y-6">
        <TableViewsCard views={table.views()} />
        <TableConnectionCard
          baseId={baseId}
          tableId={tableId}
          table={table}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

type TableSchemaCardProps = {
  table: TableAggregate;
};

function TableSchemaCard({ table }: TableSchemaCardProps) {
  const fields = table.fields();
  const primaryFieldId = table.primaryFieldId();
  const [, copyToClipboard] = useCopyToClipboard();
  const handleCopyTableJson = () => {
    void copyTableJson(table, copyToClipboard);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-lg">
          <TableIcon className="h-5 w-5 text-muted-foreground" />
          {table.name().toString()}
          <Badge variant="secondary">{fields.length} fields</Badge>
        </CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={handleCopyTableJson}>
            <Copy className="h-4 w-4" />
            Copy JSON
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <UITable>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Field ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>DB Field</TableHead>
              <TableHead>Primary</TableHead>
              <TableHead>Options</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const dbFieldName = getDbFieldName(field);
              const isPrimary = field.id().equals(primaryFieldId);
              return (
                <TableRow key={field.id().toString()}>
                  <TableCell className="font-medium">{field.name().toString()}</TableCell>
                  <TableCell className="break-all font-mono text-xs text-muted-foreground">
                    {field.id().toString()}
                  </TableCell>
                  <TableCell>{field.type().toString()}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {dbFieldName ?? '-'}
                  </TableCell>
                  <TableCell>
                    {isPrimary ? (
                      <Badge variant="outline">Primary</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>{renderFieldOptions(field)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </UITable>
      </CardContent>
    </Card>
  );
}

type TableJsonCardProps = {
  table: TableAggregate;
  tableJson: ITableDto | null;
  tableJsonError: string | null;
};

function TableJsonCard({ table, tableJson, tableJsonError }: TableJsonCardProps) {
  const [, copyToClipboard] = useCopyToClipboard();
  const handleCopyTableJson = () => {
    void copyTableJson(table, copyToClipboard);
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60">
        <CardTitle className="flex items-center gap-3 text-lg">
          <FileJson className="h-5 w-5 text-muted-foreground" />
          Table JSON
          <Badge variant="secondary">{table.fields().length} fields</Badge>
          <Badge variant="outline">{table.views().length} views</Badge>
        </CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={handleCopyTableJson}>
            <Copy className="h-4 w-4" />
            Copy JSON
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {tableJsonError ? (
          <div className="px-6 py-4 text-sm text-destructive">
            Unable to render JSON: {tableJsonError}
          </div>
        ) : !tableJson ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">JSON snapshot unavailable.</div>
        ) : (
          <ScrollArea className="h-[60vh] min-h-[320px]">
            <div className="px-6 pb-6 pt-4 text-xs font-mono text-foreground">
              <JsonView
                data={tableJson}
                shouldExpandNode={shouldExpandJsonNode}
                clickToExpandNode
              />
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

type TableViewsCardProps = {
  views: ReadonlyArray<View>;
};

function TableViewsCard({ views }: TableViewsCardProps) {
  const viewLabels = views.map(formatViewLabel);
  const viewDetails = views.map((view) => {
    const columnMetaResult = getViewColumnMeta(view);
    const columnMetaEntries = columnMetaResult.value ? sortColumnMeta(columnMetaResult.value) : [];
    const hasVisibility = columnMetaEntries.some(
      ([, entry]) => entry.visible !== undefined || entry.hidden !== undefined
    );
    return {
      view,
      columnMetaEntries,
      columnMetaError: columnMetaResult.error,
      columnMetaCount: columnMetaEntries.length,
      hasVisibility,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Views</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {viewLabels.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              {viewLabels.map((viewLabel) => (
                <Badge key={viewLabel} variant="secondary">
                  {viewLabel}
                </Badge>
              ))}
            </div>
            <div className="space-y-3">
              {viewDetails.map(
                ({ view, columnMetaEntries, columnMetaError, columnMetaCount, hasVisibility }) => (
                  <div
                    key={view.id().toString()}
                    className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-foreground">
                        {view.name().toString()}
                      </div>
                      <Badge variant="secondary">{view.type().toString()}</Badge>
                      <Badge variant="outline">{columnMetaCount} columns</Badge>
                      {hasVisibility ? <Badge variant="outline">visibility</Badge> : null}
                      {columnMetaError ? (
                        <Badge variant="destructive">column meta error</Badge>
                      ) : null}
                    </div>
                    {columnMetaError ? (
                      <div className="text-xs text-destructive">{columnMetaError}</div>
                    ) : null}
                    {columnMetaEntries.length ? (
                      <UITable>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Field ID</TableHead>
                            <TableHead>Order</TableHead>
                            <TableHead>Visible</TableHead>
                            <TableHead>Hidden</TableHead>
                            <TableHead>Required</TableHead>
                            <TableHead>Width</TableHead>
                            <TableHead>Statistic</TableHead>
                            <TableHead>Extras</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {columnMetaEntries.map(([fieldId, entry]) => (
                            <TableRow key={`${view.id().toString()}-${fieldId}`}>
                              <TableCell className="break-all font-mono text-xs text-muted-foreground">
                                {fieldId}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalNumber(entry.order)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalBoolean(entry.visible)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalBoolean(entry.hidden)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalBoolean(entry.required)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalNumber(entry.width)}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {formatOptionalString(entry.statisticFunc)}
                              </TableCell>
                              <TableCell className="break-all font-mono text-xs text-muted-foreground">
                                {formatColumnMetaExtras(entry)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </UITable>
                    ) : (
                      <div className="text-xs text-muted-foreground">No column meta entries.</div>
                    )}
                  </div>
                )
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">No views defined.</div>
        )}
      </CardContent>
    </Card>
  );
}

type TableConnectionCardProps = {
  baseId: string;
  tableId: string;
  table: TableAggregate;
  isLoading: boolean;
};

function TableConnectionCard({ baseId, tableId, table, isLoading }: TableConnectionCardProps) {
  const dbTableName = getDbTableName(table);
  const tableIdValue = table.id().toString();
  const baseIdValue = table.baseId().toString();
  const resolvedTableId = tableIdValue || tableId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>Base ID</span>
          <code className="text-xs text-foreground">{baseIdValue || baseId}</code>
        </div>
        <div className="flex items-center justify-between">
          <span>Table ID</span>
          <code className="text-xs text-foreground">{resolvedTableId}</code>
        </div>
        <div className="flex items-center justify-between">
          <span>DB Table</span>
          <code className="text-xs text-foreground">{dbTableName ?? '-'}</code>
        </div>
        <div className="flex items-center justify-between">
          <span>Status</span>
          <Badge variant="outline">{isLoading ? 'loading' : 'ready'}</Badge>
        </div>
      </CardContent>
    </Card>
  );
}
