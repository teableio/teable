import {
  mapTableToDto,
  type IListTableRecordsPaginationDto,
  type ITableDto,
  type ITableRecordDto,
} from '@teable/v2-contract-http';
import type {
  Field,
  ITableFieldPersistenceDTO,
  ITablePersistenceDTO,
  ITableRecordRealtimeDTO,
  LinkField,
  Table as TableAggregate,
  View,
  ViewColumnMetaValue,
} from '@teable/v2-core';
import type { TableTemplateDefinition } from '@teable/v2-table-templates';
import {
  Copy,
  ExternalLink,
  FileJson,
  MoreVertical,
  Pencil,
  RefreshCcw,
  Table as TableIcon,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { ColumnDef, Row, RowSelectionState } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { parseAsStringEnum, useQueryState } from 'nuqs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { JsonView } from 'react-json-view-lite';
import { toast } from 'sonner';
import { useCopyToClipboard } from 'usehooks-ts';

import { CreateTableDropdown } from '@/components/playground/CreateTableDropdown';
import { FieldCreateDialog } from '@/components/playground/FieldCreateDialog';
import { RecordCreateDialog } from '@/components/playground/RecordCreateDialog';
import { RecordDeleteDialog } from '@/components/playground/RecordDeleteDialog';
import { RecordUpdateDialog } from '@/components/playground/RecordUpdateDialog';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
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
import { DataTable } from '@/components/ui/data-table';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ShareDbDocStatus } from '@/lib/shareDb';
import { usePlaygroundEnvironment } from '@/lib/playground/environment';
import { renderFieldOptions } from './fieldOptionsVisitor';
import { formatRecordValue, stringifyRecordValue } from './recordValueVisitor';
import { SchemaCheckPanel } from './SchemaCheckPanel';
import { MetaCheckPanel } from './MetaCheckPanel';
import { UnderlyingDataPanel } from './UnderlyingDataPanel';
import { FieldLabel } from '@/components/playground/LinkFieldLabel';

const getViewColumnMeta = (
  view: View
): { value: ViewColumnMetaValue | null; error: string | null } => {
  const result = view.columnMeta();
  if (result.isOk()) {
    return { value: result.value.toDto(), error: null };
  }
  return { value: null, error: result.error.message };
};

const sortColumnMeta = (
  columnMeta: ViewColumnMetaValue
): Array<[string, ViewColumnMetaValue[string]]> =>
  Object.entries(columnMeta).sort(([, left], [, right]) => (left.order ?? 0) - (right.order ?? 0));

const formatOptionalBoolean = (value: boolean | undefined): string => {
  if (value === undefined) return '-';
  return value ? 'true' : 'false';
};

const formatOptionalNumber = (value: number | null | undefined): string => {
  if (value === undefined || value === null) return '-';
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

const tableTabValues = [
  'table',
  'records',
  'json',
  'realtime',
  'schema',
  'meta',
  'underlying',
] as const;
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
    toast.error('Unable to prepare table JSON', { description: tableDtoResult.error.message });
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
  tableId: string;
  table: TableAggregate | null;
  eventCount: number | null;
  realtimeSnapshot: ITablePersistenceDTO | null;
  realtimeStatus: ShareDbDocStatus;
  realtimeError: string | null;
  realtimeFieldSnapshots: ReadonlyArray<ITableFieldPersistenceDTO>;
  realtimeFieldStatus: ShareDbDocStatus;
  realtimeFieldError: string | null;
  realtimeRecordSnapshots: ReadonlyArray<ITableRecordRealtimeDTO>;
  realtimeRecordStatus: ShareDbDocStatus;
  realtimeRecordError: string | null;
  isInitialLoading: boolean;
  isLoading: boolean;
  records: ReadonlyArray<ITableRecordDto> | null;
  recordsPagination: IListTableRecordsPaginationDto | null;
  recordsError: string | null;
  isRecordsLoading: boolean;
  isRecordsFetching: boolean;
  isDeletingRecord: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isDeletingField: boolean;
  isRenaming: boolean;
  errorMessage: string | null;
  onRefresh: () => void;
  onFieldCreated: () => void;
  onRecordCreated?: () => void;
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => void;
  onImportCsv?: (data: { tableName: string; csvData?: string; csvUrl?: string }) => Promise<void>;
  onDelete: () => void;
  onDeleteField: (fieldId: string) => void;
  onDeleteRecords: (recordIds: string[]) => void;
  onRename: (name: string) => void;
};

export function TableMetaPage({
  baseId,
  tableId,
  table,
  realtimeSnapshot,
  realtimeStatus,
  realtimeError,
  realtimeFieldSnapshots,
  realtimeFieldStatus,
  realtimeFieldError,
  realtimeRecordSnapshots,
  realtimeRecordStatus,
  realtimeRecordError,
  isInitialLoading,
  isLoading,
  records,
  recordsPagination,
  recordsError,
  isRecordsLoading,
  isRecordsFetching,
  isDeletingRecord,
  isCreating,
  isDeleting,
  isDeletingField,
  isRenaming,
  errorMessage,
  onRefresh,
  onFieldCreated,
  onRecordCreated,
  onPaginationChange,
  templates,
  onCreateTemplate,
  onImportCsv,
  onDelete,
  onDeleteField,
  onDeleteRecords,
  onRename,
}: TableMetaPageProps) {
  const [activeTab, setActiveTab] = useQueryState(
    'tab',
    parseAsStringEnum<TableMetaTab>([...tableTabValues]).withDefault('table')
  );
  const tableDtoResult = useMemo(() => (table ? mapTableToDto(table) : null), [table]);
  const tableJson = tableDtoResult?.isOk() ? tableDtoResult.value : null;
  const tableJsonError = tableDtoResult?.isErr() ? tableDtoResult.error.message : null;

  const handleTabChange = (value: string) => {
    if (!isTableMetaTab(value)) return;
    void setActiveTab(value);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden h-full">
      <PlaygroundHeader
        baseId={baseId}
        table={table}
        isLoading={isLoading}
        isCreating={isCreating}
        isDeleting={isDeleting}
        isRenaming={isRenaming}
        onRefresh={onRefresh}
        onFieldCreated={onFieldCreated}
        templates={templates}
        onCreateTemplate={onCreateTemplate}
        onImportCsv={onImportCsv}
        onDelete={onDelete}
        onRename={onRename}
      />
      <div className="flex-1 min-h-0 flex flex-col">
        {errorMessage ? (
          <div className="px-6 pt-6">
            <PlaygroundErrorState message={errorMessage} />
          </div>
        ) : null}

        {isInitialLoading ? (
          <ScrollArea className="flex-1">
            <div className="px-6 py-6">
              <PlaygroundLoadingState />
            </div>
          </ScrollArea>
        ) : !table ? (
          <ScrollArea className="flex-1">
            <div className="px-6 py-6">
              <PlaygroundEmptyState
                isCreating={isCreating}
                templates={templates}
                onCreateTemplate={onCreateTemplate}
                onImportCsv={onImportCsv}
              />
            </div>
          </ScrollArea>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex-1 flex flex-col min-h-0 animate-fade-in"
          >
            <div className="px-6 pt-6">
              <TabsList className="h-9 w-fit rounded-full border border-border/60 bg-background/70 p-1 shadow-sm">
                <TabsTrigger
                  value="table"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  Table
                </TabsTrigger>
                <TabsTrigger
                  value="records"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  Records
                </TabsTrigger>
                <TabsTrigger
                  value="json"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  JSON
                </TabsTrigger>
                <TabsTrigger
                  value="realtime"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  Realtime
                </TabsTrigger>
                <TabsTrigger
                  value="schema"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  Schema Check
                </TabsTrigger>
                <TabsTrigger
                  value="meta"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  Meta Check
                </TabsTrigger>
                <TabsTrigger
                  value="underlying"
                  className="h-7 rounded-full px-4 text-xs font-medium text-muted-foreground data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground transition-all duration-200"
                >
                  Underlying
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="table" className="flex-1 min-h-0 mt-0 outline-none overflow-hidden">
              <ScrollArea className="h-full w-full">
                <div className="px-6 py-6">
                  <PlaygroundMetaLayout
                    table={table}
                    baseId={baseId}
                    tableId={tableId}
                    isLoading={isLoading}
                    isDeletingField={isDeletingField}
                    onDeleteField={onDeleteField}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent
              value="records"
              className="flex-1 min-h-0 mt-0 outline-none overflow-hidden flex flex-col"
            >
              <div className="flex-1 min-h-0 px-6 py-6">
                <PlaygroundRecordsLayout
                  baseId={baseId}
                  table={table}
                  records={records}
                  recordsPagination={recordsPagination}
                  recordsError={recordsError}
                  isRecordsLoading={isRecordsLoading}
                  isRecordsFetching={isRecordsFetching}
                  isDeletingRecord={isDeletingRecord}
                  onRecordCreated={onRecordCreated}
                  onPaginationChange={onPaginationChange}
                  onDeleteRecords={onDeleteRecords}
                />
              </div>
            </TabsContent>
            <TabsContent value="json" className="flex-1 min-h-0 mt-0 outline-none overflow-hidden">
              <ScrollArea className="h-full w-full">
                <div className="px-6 py-6">
                  <PlaygroundJsonLayout
                    table={table}
                    tableJson={tableJson}
                    tableJsonError={tableJsonError}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent
              value="realtime"
              className="flex-1 min-h-0 mt-0 outline-none overflow-hidden"
            >
              <ScrollArea className="h-full w-full">
                <div className="px-6 py-6">
                  <PlaygroundRealtimeLayout
                    realtimeSnapshot={realtimeSnapshot}
                    realtimeStatus={realtimeStatus}
                    realtimeError={realtimeError}
                    realtimeFieldSnapshots={realtimeFieldSnapshots}
                    realtimeFieldStatus={realtimeFieldStatus}
                    realtimeFieldError={realtimeFieldError}
                    realtimeRecordSnapshots={realtimeRecordSnapshots}
                    realtimeRecordStatus={realtimeRecordStatus}
                    realtimeRecordError={realtimeRecordError}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent
              value="schema"
              className="flex-1 min-h-0 mt-0 outline-none overflow-hidden"
            >
              <ScrollArea className="h-full w-full">
                <div className="px-6 py-6">
                  <SchemaCheckPanel
                    tableId={table.id().toString()}
                    tableName={table.name().toString()}
                    fields={table.getFields().map((field) => {
                      const fieldType = field.type().toString();
                      const baseMeta = {
                        id: field.id().toString(),
                        name: field.name().toString(),
                        type: fieldType,
                      };
                      if (fieldType === 'link') {
                        const linkField = field as LinkField;
                        return {
                          ...baseMeta,
                          relationship: linkField.relationship().toString(),
                          isOneWay: linkField.isOneWay(),
                        };
                      }
                      return baseMeta;
                    })}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="meta" className="flex-1 min-h-0 mt-0 outline-none overflow-hidden">
              <ScrollArea className="h-full w-full">
                <div className="px-6 py-6">
                  <MetaCheckPanel
                    tableId={table.id().toString()}
                    tableName={table.name().toString()}
                    fields={table.getFields().map((field) => {
                      const fieldType = field.type().toString();
                      const baseMeta = {
                        id: field.id().toString(),
                        name: field.name().toString(),
                        type: fieldType,
                      };
                      if (fieldType === 'link') {
                        const linkField = field as LinkField;
                        return {
                          ...baseMeta,
                          relationship: linkField.relationship().toString(),
                          isOneWay: linkField.isOneWay(),
                        };
                      }
                      return baseMeta;
                    })}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent
              value="underlying"
              className="flex-1 min-h-0 mt-0 outline-none overflow-hidden"
            >
              <ScrollArea className="h-full w-full">
                <div className="px-6 py-6">
                  <UnderlyingDataPanel
                    tableId={table.id().toString()}
                    tableName={table.name().toString()}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

type PlaygroundHeaderProps = {
  baseId: string;
  table: TableAggregate | null;
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: boolean;
  isRenaming: boolean;
  onRefresh: () => void;
  onFieldCreated: () => void;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => void;
  onImportCsv?: (data: { tableName: string; csvData?: string; csvUrl?: string }) => Promise<void>;
  onDelete: () => void;
  onRename: (name: string) => void;
};

function PlaygroundHeader({
  baseId,
  table,
  isLoading,
  isCreating,
  isDeleting,
  isRenaming,
  onRefresh,
  onFieldCreated,
  templates,
  onCreateTemplate,
  onImportCsv,
  onDelete,
  onRename,
}: PlaygroundHeaderProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const canDelete = !!table && !isDeleting;
  const currentName = table ? table.name().toString() : '';
  const tableName = table ? table.name().toString() : 'Table';
  const fieldCount = table ? table.getFields().length : null;
  const trimmedRename = renameValue.trim();
  const canRename =
    !!table && trimmedRename.length > 0 && trimmedRename !== currentName && !isRenaming;
  const appBaseUrl = import.meta.env.VITE_APP_URL?.trim();
  const appTableUrl =
    table && appBaseUrl
      ? (() => {
          const resolvedTableId = table.id().toString();
          try {
            return new URL(`/base/${baseId}/table/${resolvedTableId}`, appBaseUrl).toString();
          } catch {
            return null;
          }
        })()
      : null;

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
    <header className="relative flex flex-wrap items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-5 py-4 backdrop-blur">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-muted/35 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.2]" />
      <div className="relative flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <SidebarTrigger className="-ml-1" />
          <div className="h-6 w-px bg-gradient-to-b from-transparent via-border to-transparent" />
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20">
              <TableIcon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-base font-semibold tracking-tight">{tableName}</span>
            {appTableUrl ? (
              <Button variant="ghost" size="icon-sm" className="h-6 w-6" asChild>
                <a href={appTableUrl} target="_blank" rel="noreferrer" title="Open in App">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            ) : null}
          </div>
          <div className="ml-2 flex flex-wrap items-center gap-1.5">
            {fieldCount !== null ? (
              <Badge
                variant="secondary"
                className="h-5 px-2 text-[10px] font-medium uppercase tracking-wider"
              >
                {fieldCount} fields
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs font-normal"
            disabled={!table || isLoading}
            onClick={onRefresh}
          >
            <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          {table && (
            <FieldCreateDialog
              baseId={baseId}
              tableId={table.id().toString()}
              onSuccess={onFieldCreated}
            />
          )}
          <CreateTableDropdown
            templates={templates}
            isCreating={isCreating}
            onSelect={onCreateTemplate}
            onImportCsv={onImportCsv}
            label="Create table"
            className="h-9"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-9 w-9"
                aria-label="Table actions"
                disabled={!table}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                disabled={!table || isRenaming}
                className="text-xs py-1.5"
                onSelect={(event) => {
                  event.preventDefault();
                  setRenameOpen(true);
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename table
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs py-1.5 text-destructive focus:text-destructive"
                disabled={!canDelete}
                onSelect={(event) => {
                  event.preventDefault();
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete table
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
    <div className="space-y-3 min-w-0">
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-3">
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
      </div>
    </div>
  );
}

type PlaygroundEmptyStateProps = {
  isCreating: boolean;
  templates: ReadonlyArray<TableTemplateDefinition>;
  onCreateTemplate: (
    template: TableTemplateDefinition,
    options: { includeRecords: boolean }
  ) => void;
  onImportCsv?: (data: { tableName: string; csvData?: string; csvUrl?: string }) => Promise<void>;
};

function PlaygroundEmptyState({
  isCreating,
  templates,
  onCreateTemplate,
  onImportCsv,
}: PlaygroundEmptyStateProps) {
  return (
    <Card className="relative overflow-hidden border border-dashed border-border/70 bg-background/80">
      <div className="pointer-events-none absolute inset-0 bg-dot-pattern opacity-[0.25]" />
      <CardHeader className="relative pb-2 pt-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-2 ring-primary/20 animate-float">
          <TableIcon className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-xl font-bold tracking-tight text-foreground">
          Build a table in seconds
        </CardTitle>
      </CardHeader>
      <CardContent className="relative space-y-6 pb-8 text-center">
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          This playground uses Teable v2 core with a fixed actor. Pick a template to create a table,
          view its schema, or switch the base ID from the sidebar.
        </p>
        <div className="flex justify-center">
          <CreateTableDropdown
            templates={templates}
            isCreating={isCreating}
            onSelect={onCreateTemplate}
            onImportCsv={onImportCsv}
            label="Create table"
          />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6 pt-4 text-[11px] text-muted-foreground/70">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500/60" />
            <span>Templates available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-sky-500/60" />
            <span>CSV import supported</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type PlaygroundMetaLayoutProps = {
  table: TableAggregate;
  baseId: string;
  tableId: string;
  isLoading: boolean;
  isDeletingField: boolean;
  onDeleteField: (fieldId: string) => void;
};

function PlaygroundMetaLayout({
  table,
  baseId,
  tableId,
  isLoading,
  isDeletingField,
  onDeleteField,
}: PlaygroundMetaLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <TableSchemaCard
        table={table}
        baseId={baseId}
        tableId={tableId}
        isDeletingField={isDeletingField}
        onDeleteField={onDeleteField}
      />
      <TableViewsCard views={table.views()} fields={table.getFields()} />
      <TableConnectionCard baseId={baseId} tableId={tableId} table={table} isLoading={isLoading} />
    </div>
  );
}

type PlaygroundRecordsLayoutProps = {
  baseId: string;
  table: TableAggregate;
  records: ReadonlyArray<ITableRecordDto> | null;
  recordsPagination: IListTableRecordsPaginationDto | null;
  recordsError: string | null;
  isRecordsLoading: boolean;
  isRecordsFetching: boolean;
  isDeletingRecord: boolean;
  onRecordCreated?: () => void;
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void;
  onDeleteRecords: (recordIds: string[]) => void;
};

function PlaygroundRecordsLayout({
  baseId,
  table,
  records,
  recordsPagination,
  recordsError,
  isRecordsLoading,
  isRecordsFetching,
  isDeletingRecord,
  onRecordCreated,
  onPaginationChange,
  onDeleteRecords,
}: PlaygroundRecordsLayoutProps) {
  return (
    <div className="flex flex-col h-full min-h-0 space-y-6">
      <TableRecordsCard
        baseId={baseId}
        table={table}
        records={records}
        recordsPagination={recordsPagination}
        recordsError={recordsError}
        isRecordsLoading={isRecordsLoading}
        isRecordsFetching={isRecordsFetching}
        isDeletingRecord={isDeletingRecord}
        onRecordCreated={onRecordCreated}
        onPaginationChange={onPaginationChange}
        onDeleteRecords={onDeleteRecords}
      />
    </div>
  );
}

type PlaygroundJsonLayoutProps = {
  table: TableAggregate;
  tableJson: ITableDto | null;
  tableJsonError: string | null;
};

function PlaygroundJsonLayout({ table, tableJson, tableJsonError }: PlaygroundJsonLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <TableJsonCard table={table} tableJson={tableJson} tableJsonError={tableJsonError} />
    </div>
  );
}

type PlaygroundRealtimeLayoutProps = {
  realtimeSnapshot: ITablePersistenceDTO | null;
  realtimeStatus: ShareDbDocStatus;
  realtimeError: string | null;
  realtimeFieldSnapshots: ReadonlyArray<ITableFieldPersistenceDTO>;
  realtimeFieldStatus: ShareDbDocStatus;
  realtimeFieldError: string | null;
  realtimeRecordSnapshots: ReadonlyArray<ITableRecordRealtimeDTO>;
  realtimeRecordStatus: ShareDbDocStatus;
  realtimeRecordError: string | null;
};

function PlaygroundRealtimeLayout({
  realtimeSnapshot,
  realtimeStatus,
  realtimeError,
  realtimeFieldSnapshots,
  realtimeFieldStatus,
  realtimeFieldError,
  realtimeRecordSnapshots,
  realtimeRecordStatus,
  realtimeRecordError,
}: PlaygroundRealtimeLayoutProps) {
  return (
    <div className="space-y-6 min-w-0">
      <RealtimeSnapshotCard
        snapshot={realtimeSnapshot}
        status={realtimeStatus}
        error={realtimeError}
        title="ShareDB Table Snapshot"
      />
      <RealtimeFieldsCard
        snapshots={realtimeFieldSnapshots}
        status={realtimeFieldStatus}
        error={realtimeFieldError}
      />
      <RealtimeRecordsCard
        snapshots={realtimeRecordSnapshots}
        status={realtimeRecordStatus}
        error={realtimeRecordError}
      />
    </div>
  );
}

type TableSchemaCardProps = {
  table: TableAggregate;
  baseId: string;
  tableId: string;
  isDeletingField: boolean;
  onDeleteField: (fieldId: string) => void;
};

function TableSchemaCard({
  table,
  baseId,
  tableId,
  isDeletingField,
  onDeleteField,
}: TableSchemaCardProps) {
  const fields = table.getFields();
  const primaryFieldId = table.primaryFieldId();
  const [, copyToClipboard] = useCopyToClipboard();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Field | null>(null);
  const canDeleteField = !!deleteTarget && !isDeletingField;
  const handleCopyTableJson = () => {
    void copyTableJson(table, copyToClipboard);
  };
  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    onDeleteField(deleteTarget.id().toString());
    setDeleteOpen(false);
  };
  const handleCopyFieldPath = (fieldId: string) => {
    const path = `${baseId}/${tableId}/${fieldId}`;
    copyToClipboard(path)
      .then((success) => {
        if (success) {
          toast.success('Field path copied');
        } else {
          toast.error('Failed to copy field path');
        }
      })
      .catch(() => {
        toast.error('Failed to copy field path');
      });
  };
  const deleteFieldLabel = deleteTarget ? deleteTarget.name().toString() : 'this field';

  return (
    <section className="space-y-4 min-w-0 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
            <TableIcon className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">{table.name().toString()}</span>
          <Badge
            variant="secondary"
            className="h-5 px-2 text-[10px] font-medium uppercase tracking-wider"
          >
            {fields.length} fields
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-normal hover:bg-primary/5 hover:border-primary/30 transition-colors"
          onClick={handleCopyTableJson}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy JSON
        </Button>
      </div>
      <div className="overflow-auto rounded-xl border border-border/50 bg-gradient-to-b from-muted/20 to-transparent shadow-sm">
        <UITable>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Field ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>DB Field</TableHead>
              <TableHead>Info</TableHead>
              <TableHead>Options</TableHead>
              <TableHead className="w-12 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const dbFieldName = getDbFieldName(field);
              const isPrimary = field.id().equals(primaryFieldId);
              const disableDelete = isPrimary || isDeletingField;
              return (
                <TableRow key={field.id().toString()} className="group">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FieldLabel field={field} className="min-w-0" />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-6 w-6 opacity-60 transition-opacity group-hover:opacity-100"
                        aria-label="Copy field path"
                        onClick={() => handleCopyFieldPath(field.id().toString())}
                      >
                        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </Button>
                    </div>
                  </TableCell>

                  <TableCell className="break-all font-mono text-xs text-muted-foreground">
                    {field.id().toString()}
                  </TableCell>
                  <TableCell>{field.type().toString()}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {dbFieldName ?? '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {isPrimary ? <Badge variant="outline">Primary</Badge> : null}
                      {field.type().toString() === 'lookup' ? (
                        <Badge variant="secondary">Lookup</Badge>
                      ) : null}
                      {!isPrimary && field.type().toString() !== 'lookup' ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{renderFieldOptions(field)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-7 w-7"
                      aria-label={`Delete ${field.name().toString()}`}
                      disabled={disableDelete}
                      onClick={() => {
                        setDeleteTarget(field);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </UITable>
      </div>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete field</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteFieldLabel}&quot;? This will remove its schema and metadata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingField}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60"
              onClick={handleDeleteConfirm}
              disabled={!canDeleteField}
            >
              {isDeletingField ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type TableRecordsCardProps = {
  baseId: string;
  table: TableAggregate;
  records: ReadonlyArray<ITableRecordDto> | null;
  recordsPagination: IListTableRecordsPaginationDto | null;
  recordsError: string | null;
  isRecordsLoading: boolean;
  isRecordsFetching: boolean;
  isDeletingRecord: boolean;
  onRecordCreated?: () => void;
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void;
  onDeleteRecords: (recordIds: string[]) => void;
};

function TableRecordsCard({
  baseId,
  table,
  records,
  recordsPagination,
  recordsError,
  isRecordsLoading,
  isRecordsFetching,
  isDeletingRecord,
  onRecordCreated,
  onPaginationChange,
  onDeleteRecords,
}: TableRecordsCardProps) {
  const [, copyToClipboard] = useCopyToClipboard();
  const fields = table.getFields();
  const primaryFieldId = table.primaryFieldId().toString();
  const tableId = table.id().toString();
  const totalRecords = recordsPagination?.total ?? records?.length ?? 0;
  const isInitialLoading = isRecordsLoading && !records;
  const [updateTarget, setUpdateTarget] = useState<ITableRecordDto | null>(null);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [pendingDeleteLabel, setPendingDeleteLabel] = useState<string | null>(null);
  const env = usePlaygroundEnvironment();

  const handleUpdateOpen = useCallback((record: ITableRecordDto) => {
    setUpdateTarget(record);
    setIsUpdateOpen(true);
  }, []);

  const handleUpdateOpenChange = useCallback((nextOpen: boolean) => {
    setIsUpdateOpen(nextOpen);
    if (!nextOpen) {
      setUpdateTarget(null);
    }
  }, []);

  useEffect(() => {
    setRowSelection({});
  }, [recordsPagination?.offset, recordsPagination?.limit, tableId]);

  const resolveRecordLabel = useCallback(
    (record: ITableRecordDto) => {
      const value = record.fields[primaryFieldId];
      const label = stringifyRecordValue(value);
      return label.trim() || record.id;
    },
    [primaryFieldId]
  );

  const selectedRecordIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, selected]) => selected)
        .map(([key]) => key),
    [rowSelection]
  );

  const canDeleteSelected = selectedRecordIds.length > 0 && !isDeletingRecord;

  const openDeleteDialog = useCallback((recordIds: string[], label?: string) => {
    setPendingDeleteIds(recordIds);
    setPendingDeleteLabel(label ?? null);
    setDeleteDialogOpen(true);
  }, []);

  const handleCopyRecordId = useCallback(
    (recordId: string) => {
      copyToClipboard(recordId)
        .then((success) => {
          if (success) {
            toast.success('Record ID copied to clipboard');
          } else {
            toast.error('Failed to copy Record ID');
          }
        })
        .catch(() => {
          toast.error('Failed to copy Record ID');
        });
    },
    [copyToClipboard]
  );

  const handleCopyRecordJson = useCallback(
    (record: ITableRecordDto) => {
      const payload = JSON.stringify(record, null, 2);
      copyToClipboard(payload)
        .then((success) => {
          if (success) {
            toast.success('Row JSON copied to clipboard');
          } else {
            toast.error('Failed to copy row JSON');
          }
        })
        .catch(() => {
          toast.error('Failed to copy row JSON');
        });
    },
    [copyToClipboard]
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!pendingDeleteIds.length) return;
    onDeleteRecords(pendingDeleteIds);
    setRowSelection({});
  }, [onDeleteRecords, pendingDeleteIds]);

  const columns = useMemo<ColumnDef<ITableRecordDto>[]>(() => {
    // Sort fields: primary field first, then others
    const sortedFields = [...fields].sort((a, b) => {
      const aIsPrimary = a.id().toString() === primaryFieldId;
      const bIsPrimary = b.id().toString() === primaryFieldId;
      if (aIsPrimary) return -1;
      if (bIsPrimary) return 1;
      return 0;
    });

    const selectionColumn: ColumnDef<ITableRecordDto> = {
      id: 'select',
      header: ({ table }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? 'indeterminate'
                  : false
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(Boolean(value))}
            aria-label="Select all rows"
          />
        </div>
      ),
      cell: ({ row }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(Boolean(value))}
            aria-label={`Select record ${row.original.id}`}
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
      size: 36,
    };

    const fieldColumns: ColumnDef<ITableRecordDto>[] = sortedFields.map((field) => {
      const isPrimary = field.id().toString() === primaryFieldId;
      return {
        id: field.id().toString(),
        header: () => <FieldLabel field={field} className="min-w-0" />,
        cell: ({ row }) => {
          const value = row.original.fields[field.id().toString()];
          const formattedValue = formatRecordValue(field, value);

          if (isPrimary) {
            const label =
              formattedValue.text && formattedValue.text !== '-'
                ? formattedValue.text
                : resolveRecordLabel(row.original);
            return (
              <div className="relative w-full min-w-0 group">
                <Link
                  to={env.routes.record}
                  params={{ baseId, tableId, recordId: row.original.id }}
                  search={(prev) => prev}
                  className="absolute inset-0"
                  aria-label={label}
                >
                  <span className="sr-only">{label}</span>
                </Link>
                <span
                  className={cn(
                    'block truncate text-left text-primary underline underline-offset-2 group-hover:text-primary/80',
                    formattedValue.cellClassName
                  )}
                  title={label}
                >
                  {label}
                </span>
              </div>
            );
          }

          return (
            <div
              className={cn('max-w-[220px] min-w-0 truncate', formattedValue.cellClassName)}
              title={formattedValue.text}
            >
              {formattedValue.node}
            </div>
          );
        },
        size: isPrimary ? 150 : 150,
      };
    });

    const actionsColumn: ColumnDef<ITableRecordDto> = {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleUpdateOpen(row.original)}>
              <Pencil className="mr-2 h-4 w-4" />
              Update record
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCopyRecordId(row.original.id)}>
              <Copy className="mr-2 h-4 w-4" />
              Copy Record ID
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleCopyRecordJson(row.original)}>
              <FileJson className="mr-2 h-4 w-4" />
              Copy Row JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={isDeletingRecord}
              onClick={() => openDeleteDialog([row.original.id], resolveRecordLabel(row.original))}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete record
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    };

    return [selectionColumn, ...fieldColumns, actionsColumn];
  }, [
    fields,
    primaryFieldId,
    handleUpdateOpen,
    handleCopyRecordId,
    handleCopyRecordJson,
    onDeleteRecords,
    openDeleteDialog,
    resolveRecordLabel,
    baseId,
    tableId,
    env.routes.record,
    isDeletingRecord,
  ]);

  const data = useMemo(() => (records ?? []) as ITableRecordDto[], [records]);

  const pinnedColumns = useMemo(
    () => ({
      left: ['select', primaryFieldId],
    }),
    [primaryFieldId]
  );

  // Calculate pagination state for DataTable
  const paginationForTable = useMemo(() => {
    if (!recordsPagination || !onPaginationChange) return undefined;
    const pageIndex = Math.floor(recordsPagination.offset / recordsPagination.limit);
    return {
      pageIndex,
      pageSize: recordsPagination.limit,
      total: recordsPagination.total,
    };
  }, [recordsPagination, onPaginationChange]);

  const rowContextMenuContent = useCallback(
    (row: Row<ITableRecordDto>) => (
      <>
        <ContextMenuItem onClick={() => handleUpdateOpen(row.original)}>
          <Pencil className="mr-2 h-4 w-4" />
          Update record
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleCopyRecordId(row.original.id)}>
          <Copy className="mr-2 h-4 w-4" />
          Copy Record ID
        </ContextMenuItem>
        <ContextMenuItem onClick={() => handleCopyRecordJson(row.original)}>
          <FileJson className="mr-2 h-4 w-4" />
          Copy Row JSON
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          disabled={isDeletingRecord}
          onClick={() => openDeleteDialog([row.original.id], resolveRecordLabel(row.original))}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete record
        </ContextMenuItem>
      </>
    ),
    [
      handleUpdateOpen,
      handleCopyRecordId,
      handleCopyRecordJson,
      isDeletingRecord,
      openDeleteDialog,
      resolveRecordLabel,
    ]
  );

  return (
    <section className="flex flex-col h-full min-h-0 space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 ring-1 ring-emerald-500/20">
            <TableIcon className="h-4 w-4 text-emerald-600" />
          </div>
          <span>Records</span>
          <Badge
            variant="secondary"
            className="h-5 px-2 text-[10px] font-medium uppercase tracking-wider"
          >
            {totalRecords} total
          </Badge>
          {isRecordsFetching ? (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
            >
              Loading
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {selectedRecordIds.length > 0 ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              disabled={!canDeleteSelected}
              onClick={() => openDeleteDialog(selectedRecordIds)}
            >
              Delete selected ({selectedRecordIds.length})
            </Button>
          ) : null}
          {table && (
            <RecordCreateDialog table={table} onSuccess={onRecordCreated} baseId={baseId} />
          )}
        </div>
      </div>
      {recordsError ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4" />
          <span>{recordsError}</span>
        </div>
      ) : isInitialLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`record-header-skeleton-${index}`} className="h-4 w-full" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, rowIndex) => (
            <div key={`record-row-skeleton-${rowIndex}`} className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, colIndex) => (
                <Skeleton
                  key={`record-cell-skeleton-${rowIndex}-${colIndex}`}
                  className="h-4 w-full"
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          className="flex-1 min-h-0"
          emptyMessage="No records yet."
          pinnedColumns={pinnedColumns}
          pagination={paginationForTable}
          onPaginationChange={onPaginationChange}
          enableRowSelection
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          getRowId={(row) => row.id}
          rowContextMenuContent={rowContextMenuContent}
        />
      )}
      {updateTarget ? (
        <RecordUpdateDialog
          table={table}
          record={updateTarget}
          baseId={baseId}
          open={isUpdateOpen}
          onOpenChange={handleUpdateOpenChange}
          onSuccess={onRecordCreated}
        />
      ) : null}
      <RecordDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setPendingDeleteIds([]);
            setPendingDeleteLabel(null);
          }
        }}
        tableId={tableId}
        recordIds={pendingDeleteIds}
        recordLabel={pendingDeleteLabel}
        isDeleting={isDeletingRecord}
        onConfirm={handleDeleteConfirm}
      />
    </section>
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
    <section className="space-y-4 min-w-0 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/15 to-amber-500/5 ring-1 ring-amber-500/20">
            <FileJson className="h-4 w-4 text-amber-600" />
          </div>
          <span>Table JSON</span>
          <Badge
            variant="secondary"
            className="h-5 px-2 text-[10px] font-medium uppercase tracking-wider"
          >
            {table.getFields().length} fields
          </Badge>
          <Badge
            variant="outline"
            className="h-5 px-2 text-[10px] font-medium uppercase tracking-wider"
          >
            {table.views().length} views
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-normal hover:bg-primary/5 hover:border-primary/30 transition-colors"
          onClick={handleCopyTableJson}
        >
          <Copy className="h-3.5 w-3.5" />
          Copy JSON
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/50 bg-gradient-to-b from-muted/20 to-transparent shadow-sm">
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
      </div>
    </section>
  );
}

type RealtimeSnapshotCardProps = {
  snapshot: unknown;
  status: ShareDbDocStatus;
  error: string | null;
  title: string;
};

const formatRealtimeStatusLabel = (status: ShareDbDocStatus): string => {
  if (status === 'ready') return 'Live';
  if (status === 'connecting') return 'Connecting';
  if (status === 'error') return 'Error';
  return 'Idle';
};

const resolveRealtimeStatusVariant = (
  status: ShareDbDocStatus
): 'secondary' | 'outline' | 'destructive' => {
  if (status === 'ready') return 'secondary';
  if (status === 'error') return 'destructive';
  return 'outline';
};

function RealtimeSnapshotCard({ snapshot, status, error, title }: RealtimeSnapshotCardProps) {
  const statusLabel = formatRealtimeStatusLabel(status);
  const statusVariant = resolveRealtimeStatusVariant(status);

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <FileJson className="h-4 w-4 text-muted-foreground" />
        {title}
        <Badge
          variant={statusVariant}
          className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
        >
          {statusLabel}
        </Badge>
      </div>
      <div className="overflow-hidden rounded-md border border-border/60">
        {error ? (
          <div className="px-6 py-4 text-sm text-destructive">Realtime error: {error}</div>
        ) : !snapshot ? (
          <div className="px-6 py-4 text-sm text-muted-foreground">
            Waiting for ShareDB snapshot.
          </div>
        ) : (
          <ScrollArea className="h-[60vh] min-h-[320px]">
            <div className="px-6 pb-6 pt-4 text-xs font-mono text-foreground">
              <JsonView data={snapshot} shouldExpandNode={shouldExpandJsonNode} clickToExpandNode />
            </div>
          </ScrollArea>
        )}
      </div>
    </section>
  );
}

type RealtimeFieldsCardProps = {
  snapshots: ReadonlyArray<ITableFieldPersistenceDTO>;
  status: ShareDbDocStatus;
  error: string | null;
};

function RealtimeFieldsCard({ snapshots, status, error }: RealtimeFieldsCardProps) {
  return (
    <RealtimeSnapshotCard
      snapshot={snapshots}
      status={status}
      error={error}
      title="ShareDB Field Query"
    />
  );
}

type RealtimeRecordsCardProps = {
  snapshots: ReadonlyArray<ITableRecordRealtimeDTO>;
  status: ShareDbDocStatus;
  error: string | null;
};

function RealtimeRecordsCard({ snapshots, status, error }: RealtimeRecordsCardProps) {
  return (
    <RealtimeSnapshotCard
      snapshot={snapshots}
      status={status}
      error={error}
      title="ShareDB Record Query"
    />
  );
}

type TableViewsCardProps = {
  views: ReadonlyArray<View>;
  fields: ReadonlyArray<Field>;
};

function TableViewsCard({ views, fields }: TableViewsCardProps) {
  const fieldById = useMemo(() => {
    const map = new Map<string, Field>();
    fields.forEach((field) => {
      map.set(field.id().toString(), field);
    });
    return map;
  }, [fields]);

  const viewDetails = useMemo(
    () =>
      views.map((view) => {
        const columnMetaResult = getViewColumnMeta(view);
        const columnMetaEntries = columnMetaResult.value
          ? sortColumnMeta(columnMetaResult.value)
          : [];
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
      }),
    [views]
  );

  const [activeViewId, setActiveViewId] = useState<string>(() => {
    const first = viewDetails[0]?.view.id().toString();
    return first ?? '';
  });

  useEffect(() => {
    if (!viewDetails.length) return;
    const activeExists = viewDetails.some((entry) => entry.view.id().toString() === activeViewId);
    if (!activeViewId || !activeExists) {
      setActiveViewId(viewDetails[0].view.id().toString());
    }
  }, [activeViewId, viewDetails]);

  const renderViewFieldLabel = (fieldId: string) => {
    const field = fieldById.get(fieldId);
    if (!field) {
      return (
        <span className="break-all font-mono text-xs text-muted-foreground" title={fieldId}>
          {fieldId}
        </span>
      );
    }

    return <FieldLabel field={field} className="min-w-0" />;
  };

  return (
    <section className="space-y-3 min-w-0">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Views</div>
        <Badge
          variant="outline"
          className="h-5 px-2 text-[10px] font-medium uppercase tracking-wider"
        >
          {views.length} views
        </Badge>
      </div>

      {viewDetails.length ? (
        <Tabs value={activeViewId} onValueChange={setActiveViewId} className="w-full">
          <TabsList className="h-auto flex flex-wrap justify-start gap-1 bg-muted/20">
            {viewDetails.map(({ view }) => (
              <TabsTrigger
                key={view.id().toString()}
                value={view.id().toString()}
                className="max-w-full"
              >
                <span className="max-w-[180px] truncate">{view.name().toString()}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {viewDetails.map(
            ({ view, columnMetaEntries, columnMetaError, columnMetaCount, hasVisibility }) => (
              <TabsContent key={view.id().toString()} value={view.id().toString()} className="mt-3">
                <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
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
                    <div className="overflow-auto rounded-md border border-border/40 bg-background/50">
                      <UITable>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Field</TableHead>
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
                              <TableCell className="min-w-[220px]">
                                {renderViewFieldLabel(fieldId)}
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
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No column meta entries.</div>
                  )}
                </div>
              </TabsContent>
            )
          )}
        </Tabs>
      ) : (
        <div className="text-sm text-muted-foreground">No views defined.</div>
      )}
    </section>
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
    <section className="space-y-3 min-w-0">
      <div className="text-sm font-semibold">Connection</div>
      <div className="space-y-2 text-xs text-muted-foreground">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>Base ID</span>
          <code className="break-all text-[11px] text-foreground font-mono sm:text-right">
            {baseIdValue || baseId}
          </code>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>Table ID</span>
          <code className="break-all text-[11px] text-foreground font-mono sm:text-right">
            {resolvedTableId}
          </code>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <span>DB Table</span>
          <code className="break-all text-[11px] text-foreground font-mono sm:text-right">
            {dbTableName ?? '-'}
          </code>
        </div>
        <div className="flex items-center justify-between">
          <span>Status</span>
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider"
          >
            {isLoading ? 'loading' : 'ready'}
          </Badge>
        </div>
      </div>
    </section>
  );
}
