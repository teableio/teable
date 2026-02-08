import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { mapTableDtoToDomain, type ITableRecordDto } from '@teable/v2-contract-http';
import type {
  Field,
  ITableRecordRealtimeDTO,
  LinkField,
  Table as TableAggregate,
} from '@teable/v2-core';

import {
  formatRecordValue,
  stringifyRecordValue,
} from '@/components/playground/recordValueVisitor';
import { FieldLabel } from '@/components/playground/LinkFieldLabel';
import { ArrowLeft, Pencil, TriangleAlert, Radio, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { RecordDeleteDialog } from '@/components/playground/RecordDeleteDialog';
import { RecordUpdateDialog } from '@/components/playground/RecordUpdateDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table as UITable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBroadcastChannelDoc } from '@/lib/broadcastChannel';
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { usePlaygroundEnvironment } from '@/lib/playground/environment';
import { useShareDbDoc, type ShareDbDocStatus } from '@/lib/shareDb';

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

const isEmptyRecordValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

type LinkValueItem = {
  id: string;
  label: string;
};

const resolveLinkLabel = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const candidate = value as { title?: unknown; name?: unknown; id?: unknown };
    if (typeof candidate.title === 'string') return candidate.title;
    if (typeof candidate.name === 'string') return candidate.name;
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return null;
};

const resolveLinkId = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { id?: unknown };
    if (typeof candidate.id === 'string') return candidate.id;
  }
  return null;
};

const extractLinkValues = (value: unknown): LinkValueItem[] => {
  if (isEmptyRecordValue(value)) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((entry) => {
      const id = resolveLinkId(entry);
      if (!id) return null;
      const label = resolveLinkLabel(entry) ?? id;
      return { id, label };
    })
    .filter((entry): entry is LinkValueItem => Boolean(entry));
};

type PlaygroundRecordRouteProps = {
  baseId: string;
  tableId: string;
  recordId: string;
};

export function PlaygroundRecordRoute({ baseId, tableId, recordId }: PlaygroundRecordRouteProps) {
  const env = usePlaygroundEnvironment();
  const navigate = useNavigate();
  const orpcClient = useOrpcClient();
  const orpc = createTanstackQueryUtils(orpcClient);
  const queryClient = useQueryClient();

  const tableQuery = useQuery(
    orpc.tables.getById.queryOptions({
      input: { baseId, tableId },
      placeholderData: keepPreviousData,
      select: (response) => response.data.table,
    })
  );

  const recordQuery = useQuery(
    orpc.tables.getRecord.queryOptions({
      input: { tableId, recordId },
      enabled: Boolean(recordId),
      placeholderData: keepPreviousData,
      select: (response) => response.data.record,
    })
  );

  // Realtime subscription for single record
  const isSandbox = env.kind === 'sandbox';
  const realtimeRecordCollection = useMemo(() => `rec_${tableId}`, [tableId]);

  const shareDbRecord = useShareDbDoc<ITableRecordRealtimeDTO>({
    collection: realtimeRecordCollection,
    docId: recordId,
    enabled: !isSandbox && !!tableId && !!recordId,
  });

  const broadcastRecord = useBroadcastChannelDoc<ITableRecordRealtimeDTO>({
    collection: realtimeRecordCollection,
    docId: recordId,
    enabled: isSandbox && !!tableId && !!recordId,
  });

  const realtimeRecord = isSandbox ? broadcastRecord : shareDbRecord;

  // Sync realtime data to TanStack Query cache
  useEffect(() => {
    if (!realtimeRecord.data) return;

    const queryKey = orpc.tables.getRecord.queryOptions({
      input: { tableId, recordId },
    }).queryKey;

    type RecordQueryData = { ok: true; data: { record: ITableRecordDto } };

    queryClient.setQueryData<RecordQueryData | undefined>(queryKey, (oldData) => {
      if (!oldData?.data?.record) return oldData;

      // Merge realtime fields into cached record
      return {
        ...oldData,
        data: {
          ...oldData.data,
          record: {
            ...oldData.data.record,
            fields: {
              ...oldData.data.record.fields,
              ...realtimeRecord.data!.fields,
            },
          },
        },
      };
    });
  }, [realtimeRecord.data, queryClient, orpc, tableId, recordId]);

  const tableResult = useMemo(
    () => (tableQuery.data ? mapTableDtoToDomain(tableQuery.data) : null),
    [tableQuery.data]
  );
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error.message : null;
  const record = recordQuery.data ?? null;
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const errorMessage = (() => {
    if (mappingError) return mappingError;
    if (tableQuery.error) return getErrorMessage(tableQuery.error, 'Failed to load table');
    if (recordQuery.error) return getErrorMessage(recordQuery.error, 'Failed to load record');
    return null;
  })();

  const isLoading = tableQuery.isLoading || recordQuery.isLoading;

  const sortedFields = useMemo(() => {
    if (!table) return [] as Field[];
    const primaryFieldId = table.primaryFieldId().toString();
    return [...table.getFields()].sort((a, b) => {
      const aIsPrimary = a.id().toString() === primaryFieldId;
      const bIsPrimary = b.id().toString() === primaryFieldId;
      if (aIsPrimary) return -1;
      if (bIsPrimary) return 1;
      return 0;
    });
  }, [table]);

  const recordLabel = useMemo(() => {
    if (!table || !record) return recordId;
    const primaryFieldId = table.primaryFieldId().toString();
    const label = stringifyRecordValue(record.fields[primaryFieldId]);
    return label.trim() || record.id;
  }, [record, recordId, table]);

  const deleteRecordsMutation = useMutation(
    orpc.tables.deleteRecords.mutationOptions({
      onSuccess: (response) => {
        const deletedCount = response.data.deletedRecordIds.length;
        toast.success(`Deleted ${deletedCount} record${deletedCount === 1 ? '' : 's'}`);
        queryClient.removeQueries({
          queryKey: orpc.tables.getRecord.queryKey({
            input: { tableId, recordId },
          }),
        });
        void navigate({
          to: env.routes.table,
          params: { baseId, tableId },
          search: (prev) => prev,
        });
      },
      onError: (error) => {
        toast.error(getErrorMessage(error, 'Failed to delete record'));
      },
    })
  );

  const handleDeleteConfirm = () => {
    if (!record) return;
    deleteRecordsMutation.reset();
    deleteRecordsMutation.mutate({ tableId, recordIds: [recordId] });
    setIsDeleteOpen(false);
  };

  const handleBack = () => {
    void navigate({
      to: env.routes.table,
      params: { baseId, tableId },
      search: (prev) => prev,
    });
  };

  const resolveRecordHref = (targetBaseId: string, targetTableId: string, linkedRecordId: string) =>
    env.routes.record
      .replace('$baseId', targetBaseId)
      .replace('$tableId', targetTableId)
      .replace('$recordId', linkedRecordId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-5 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Record detail</span>
              <RealtimeStatusBadge status={realtimeRecord.status} />
            </div>
            <div className="text-base font-semibold">{recordId}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {table && record ? (
            <Button variant="outline" size="sm" onClick={() => setIsUpdateOpen(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Update record
            </Button>
          ) : null}
          {table && record ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setIsDeleteOpen(true)}
              disabled={deleteRecordsMutation.isPending}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              {deleteRecordsMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleBack}>
            Back to table
          </Button>
        </div>
      </header>
      <ScrollArea className="flex-1">
        <div className="px-6 py-6">
          {errorMessage ? (
            <Card className="border-destructive/40 bg-destructive/10">
              <CardHeader className="flex flex-row items-center gap-3">
                <TriangleAlert className="h-4 w-4 text-destructive" />
                <CardTitle className="text-base text-destructive">{errorMessage}</CardTitle>
              </CardHeader>
            </Card>
          ) : isLoading ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Loading record...</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Fetching the latest data for this record.
              </CardContent>
            </Card>
          ) : !table || !record ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Record not found</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                We couldn&apos;t locate this record in the selected table.
              </CardContent>
            </Card>
          ) : (
            <>
              <RecordDetailCard
                table={table}
                record={record}
                fields={sortedFields}
                baseId={baseId}
                resolveRecordHref={resolveRecordHref}
              />
              <RealtimeRecordCard
                realtimeRecord={realtimeRecord.data}
                status={realtimeRecord.status}
                error={realtimeRecord.error}
              />
            </>
          )}
          {table && record ? (
            <RecordUpdateDialog
              table={table}
              record={record}
              baseId={baseId}
              open={isUpdateOpen}
              onOpenChange={setIsUpdateOpen}
              onSuccess={() => void recordQuery.refetch()}
            />
          ) : null}
          <RecordDeleteDialog
            open={isDeleteOpen}
            onOpenChange={setIsDeleteOpen}
            tableId={tableId}
            recordIds={[recordId]}
            recordLabel={recordLabel}
            isDeleting={deleteRecordsMutation.isPending}
            onConfirm={handleDeleteConfirm}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

type RecordDetailCardProps = {
  table: TableAggregate;
  record: ITableRecordDto;
  fields: Field[];
  baseId: string;
  resolveRecordHref: (targetBaseId: string, targetTableId: string, recordId: string) => string;
};

function RecordDetailCard({
  table,
  record,
  fields,
  baseId,
  resolveRecordHref,
}: RecordDetailCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{table.name().toString()}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-auto">
        <UITable>
          <TableHeader>
            <TableRow>
              <TableHead className="w-64">Field</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-32">Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => {
              const fieldId = field.id().toString();
              const value = record.fields[fieldId];
              const fieldType = field.type().toString();

              let valueNode: ReactNode = null;

              if (fieldType === 'link') {
                const linkItems = extractLinkValues(value);
                const linkField = field as LinkField;
                const targetBaseId = linkField.baseId()?.toString() ?? baseId;
                const targetTableId = linkField.foreignTableId().toString();

                valueNode = linkItems.length ? (
                  <div className="flex flex-wrap gap-2">
                    {linkItems.map((item) => (
                      <a
                        key={item.id}
                        className="max-w-[240px] truncate text-sm text-primary underline underline-offset-2 hover:text-primary/80"
                        href={resolveRecordHref(targetBaseId, targetTableId, item.id)}
                        target="_blank"
                        rel="noreferrer"
                        title={item.label}
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                );
              } else {
                const formattedValue = formatRecordValue(field, value);
                valueNode = formattedValue.node;
              }

              return (
                <TableRow key={fieldId}>
                  <TableCell className="font-medium">
                    <FieldLabel field={field} className="min-w-0" />
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">{valueNode}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {field.type().toString()}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </UITable>
      </CardContent>
    </Card>
  );
}

type RealtimeStatusBadgeProps = {
  status: ShareDbDocStatus;
};

function RealtimeStatusBadge({ status }: RealtimeStatusBadgeProps) {
  const statusLabel =
    status === 'ready'
      ? 'Live'
      : status === 'connecting'
        ? 'Connecting'
        : status === 'error'
          ? 'Error'
          : 'Idle';
  const variant = status === 'ready' ? 'secondary' : status === 'error' ? 'destructive' : 'outline';

  return (
    <Badge
      variant={variant}
      className="h-5 px-1.5 text-[10px] font-normal uppercase tracking-wider gap-1"
    >
      {status === 'ready' ? <Radio className="h-2.5 w-2.5 animate-pulse" /> : null}
      {statusLabel}
    </Badge>
  );
}

type RealtimeRecordCardProps = {
  realtimeRecord: ITableRecordRealtimeDTO | null;
  status: ShareDbDocStatus;
  error: string | null;
};

function RealtimeRecordCard({ realtimeRecord, status, error }: RealtimeRecordCardProps) {
  console.log('[RealtimeRecordCard] render', { realtimeRecord, status, error });
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Realtime Snapshot</CardTitle>
          <RealtimeStatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-sm text-destructive">Realtime error: {error}</div>
        ) : !realtimeRecord ? (
          <div className="text-sm text-muted-foreground">
            {status === 'connecting' ? 'Connecting to ShareDB...' : 'Waiting for realtime data.'}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Record ID</span>
              <code className="font-mono text-xs">{realtimeRecord.id}</code>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Table ID</span>
              <code className="font-mono text-xs">{realtimeRecord.tableId}</code>
            </div>
            <div className="border-t pt-3">
              <div className="text-sm font-medium mb-2">
                Fields ({Object.keys(realtimeRecord.fields).length})
              </div>
              <div className="space-y-2 text-sm">
                {Object.entries(realtimeRecord.fields).map(([fieldId, value]) => (
                  <div key={fieldId} className="flex items-start justify-between gap-4">
                    <code className="font-mono text-xs text-muted-foreground shrink-0">
                      {fieldId}
                    </code>
                    <div className="text-right break-all">
                      {value === null || value === undefined ? (
                        <span className="text-muted-foreground">-</span>
                      ) : typeof value === 'object' ? (
                        <code className="font-mono text-xs">{JSON.stringify(value)}</code>
                      ) : (
                        <span>{String(value)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
