import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { JsonView } from 'react-json-view-lite';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Database,
  RefreshCcw,
  Table as TableIcon,
  FileJson,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns,
} from 'lucide-react';

import type {
  DebugTableMeta,
  DebugFieldMeta,
  DebugRawRecordQueryResult,
} from '@teable/v2-debug-data';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  PLAYGROUND_DB_URL_QUERY_PARAM,
  resolvePlaygroundDbUrl,
} from '@/lib/playground/databaseUrl';

type UnderlyingDataResponse = {
  tableMeta: DebugTableMeta | null;
  fields: DebugFieldMeta[] | null;
  rawRecords: DebugRawRecordQueryResult | null;
  error: string | null;
};

type UnderlyingDataPanelProps = {
  tableId: string;
  tableName: string;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const shouldExpandJsonNode = (level: number) => level < 2;

const formatMetaValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value || '-';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(value);
};

export function UnderlyingDataPanel({ tableId }: UnderlyingDataPanelProps) {
  const [activeTab, setActiveTab] = useState<'records' | 'fields' | 'meta'>('records');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Reset pagination when tableId changes
  useEffect(() => {
    setPageIndex(0);
  }, [tableId]);

  const fetchUnderlyingData = useCallback(async (): Promise<UnderlyingDataResponse> => {
    const dbUrl = resolvePlaygroundDbUrl();
    const baseUrl = `/api/underlying/${tableId}`;
    const params = new URLSearchParams();

    if (dbUrl) {
      params.set(PLAYGROUND_DB_URL_QUERY_PARAM, dbUrl);
    }
    params.set('limit', pageSize.toString());
    params.set('offset', (pageIndex * pageSize).toString());

    const url = `${baseUrl}?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    return response.json();
  }, [tableId, pageIndex, pageSize]);

  const query = useQuery({
    queryKey: ['underlying-data', tableId, pageIndex, pageSize],
    queryFn: fetchUnderlyingData,
    placeholderData: keepPreviousData,
  });

  const { data, isLoading, isFetching, refetch } = query;

  const tableMeta = data?.tableMeta ?? null;
  const fields = data?.fields ?? null;
  const rawRecords = data?.rawRecords ?? null;
  const error = data?.error ?? null;

  const totalRecords = rawRecords?.total ?? 0;
  const totalPages = Math.ceil(totalRecords / pageSize);
  const hasNext = pageIndex < totalPages - 1;
  const hasPrev = pageIndex > 0;

  const handlePageChange = useCallback((newPage: number) => {
    setPageIndex(newPage);
  }, []);

  const handlePageSizeChange = useCallback((newSize: string) => {
    setPageSize(parseInt(newSize, 10));
    setPageIndex(0);
  }, []);

  // Build dynamic columns for records from first record
  const recordColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    const records = rawRecords?.records ?? [];
    if (records.length === 0) return [];

    // Get all unique keys from records
    const keys = new Set<string>();
    for (const record of records) {
      Object.keys(record).forEach((key) => keys.add(key));
    }

    // Sort keys: regular columns first, then system columns (__id, __created_time, etc.)
    const sortedKeys = [...keys].sort((a, b) => {
      const aIsSystem = a.startsWith('__');
      const bIsSystem = b.startsWith('__');
      if (!aIsSystem && bIsSystem) return -1;
      if (aIsSystem && !bIsSystem) return 1;
      // Within system columns, put __id first
      if (aIsSystem && bIsSystem) {
        if (a === '__id') return -1;
        if (b === '__id') return 1;
      }
      return a.localeCompare(b);
    });

    return sortedKeys.map((key) => ({
      id: key,
      accessorKey: key,
      header: () => (
        <span className={cn('font-mono text-xs', key.startsWith('__') && 'text-muted-foreground')}>
          {key}
        </span>
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        const isSystem = key.startsWith('__');

        if (value === null || value === undefined) {
          return <span className="text-muted-foreground/50 italic">&lt;NULL&gt;</span>;
        }

        if (typeof value === 'object') {
          return (
            <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px] block">
              {JSON.stringify(value)}
            </span>
          );
        }

        return (
          <span
            className={cn(
              'font-mono text-xs truncate max-w-[200px] block',
              isSystem && 'text-muted-foreground'
            )}
            title={String(value)}
          >
            {String(value)}
          </span>
        );
      },
      size: key === '__id' ? 180 : 150,
    }));
  }, [rawRecords]);

  const tableData = useMemo(
    () => (rawRecords?.records ?? []) as Record<string, unknown>[],
    [rawRecords]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/15 to-violet-500/5 ring-1 ring-violet-500/20">
            <Database className="h-4 w-4 text-violet-600" />
          </div>
          <span>Underlying Data</span>
          {isFetching && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs font-normal"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCcw className={cn('h-3.5 w-3.5 mr-1.5', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-destructive">Error: {error}</CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* Internal Tabs for Records, Fields and Table Meta */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'records' | 'fields' | 'meta')}
      >
        <TabsList className="h-9 w-fit rounded-lg border border-border/60 bg-background/70 p-1">
          <TabsTrigger value="records" className="h-7 rounded-md px-3 text-xs font-medium">
            <FileJson className="h-3.5 w-3.5 mr-1.5" />
            Records
            {rawRecords && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px]">
                {totalRecords}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="fields" className="h-7 rounded-md px-3 text-xs font-medium">
            <Columns className="h-3.5 w-3.5 mr-1.5" />
            Fields
            {fields && (
              <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px]">
                {fields.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="meta" className="h-7 rounded-md px-3 text-xs font-medium">
            <TableIcon className="h-3.5 w-3.5 mr-1.5" />
            Table Meta
          </TabsTrigger>
        </TabsList>

        {/* Records Tab */}
        <TabsContent value="records" className="mt-4">
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span>Raw Records</span>
                {rawRecords && (
                  <span className="text-xs text-muted-foreground">
                    (from{' '}
                    <code className="px-1 py-0.5 bg-muted rounded">{rawRecords.dbTableName}</code>)
                  </span>
                )}
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={`header-${i}`} className="h-4 w-full" />
                  ))}
                </div>
                {Array.from({ length: 5 }).map((_, rowIndex) => (
                  <div key={`row-${rowIndex}`} className="grid grid-cols-4 gap-3">
                    {Array.from({ length: 4 }).map((_, colIndex) => (
                      <Skeleton key={`cell-${rowIndex}-${colIndex}`} className="h-4 w-full" />
                    ))}
                  </div>
                ))}
              </div>
            ) : tableData.length > 0 ? (
              <div className="space-y-3">
                <div className="overflow-auto rounded-lg border border-border/50">
                  <DataTable
                    columns={recordColumns}
                    data={tableData}
                    className="max-h-[400px]"
                    emptyMessage="No records found."
                  />
                </div>

                {/* Pagination Controls */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page:</span>
                    <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                      <SelectTrigger className="h-8 w-[70px]">
                        <SelectValue placeholder={pageSize.toString()} />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((size) => (
                          <SelectItem key={size} value={size.toString()}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Page {pageIndex + 1} of {totalPages || 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        disabled={!hasPrev}
                        onClick={() => handlePageChange(0)}
                        title="First page"
                      >
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        disabled={!hasPrev}
                        onClick={() => handlePageChange(pageIndex - 1)}
                        title="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        disabled={!hasNext}
                        onClick={() => handlePageChange(pageIndex + 1)}
                        title="Next page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        disabled={!hasNext}
                        onClick={() => handlePageChange(totalPages - 1)}
                        title="Last page"
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <span className="text-sm text-muted-foreground">
                    Showing {pageIndex * pageSize + 1}-
                    {Math.min((pageIndex + 1) * pageSize, totalRecords)} of {totalRecords}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No records found in the underlying table.
              </div>
            )}
          </section>
        </TabsContent>

        {/* Fields Tab */}
        <TabsContent value="fields" className="mt-4">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>Field Metadata</span>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : fields && fields.length > 0 ? (
              <div className="space-y-4">
                {fields.map((field) => (
                  <div
                    key={field.id}
                    className="overflow-hidden rounded-lg border border-border/50 bg-muted/10"
                  >
                    <div className="flex items-center gap-2 px-4 py-2 bg-muted/20 border-b border-border/50">
                      <span className="font-semibold text-sm">{field.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {field.type}
                      </Badge>
                      {field.isPrimary && (
                        <Badge variant="secondary" className="text-[10px]">
                          Primary
                        </Badge>
                      )}
                      {field.isComputed && (
                        <Badge variant="secondary" className="text-[10px]">
                          Computed
                        </Badge>
                      )}
                      {field.isLookup && (
                        <Badge variant="secondary" className="text-[10px]">
                          Lookup
                        </Badge>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="text-xs font-mono">
                        <JsonView
                          data={field}
                          shouldExpandNode={shouldExpandJsonNode}
                          clickToExpandNode
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No field metadata available.
              </div>
            )}
          </section>
        </TabsContent>

        {/* Table Meta Tab */}
        <TabsContent value="meta" className="mt-4">
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>Table Metadata</span>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : tableMeta ? (
              <div className="overflow-hidden rounded-lg border border-border/50 bg-muted/10">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">Property</TableHead>
                      <TableHead>Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ['ID', tableMeta.id],
                      ['Name', tableMeta.name],
                      ['Base ID', tableMeta.baseId],
                      ['DB Table Name', tableMeta.dbTableName],
                      ['DB View Name', tableMeta.dbViewName],
                      ['Description', tableMeta.description],
                      ['Icon', tableMeta.icon],
                      ['Version', tableMeta.version],
                      ['Order', tableMeta.order],
                      ['Created Time', tableMeta.createdTime],
                      ['Created By', tableMeta.createdBy],
                      ['Last Modified Time', tableMeta.lastModifiedTime],
                      ['Last Modified By', tableMeta.lastModifiedBy],
                      ['Deleted Time', tableMeta.deletedTime],
                    ].map(([label, value]) => (
                      <TableRow key={label as string}>
                        <TableCell className="font-medium text-muted-foreground">{label}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatMetaValue(value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No table metadata available.
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
