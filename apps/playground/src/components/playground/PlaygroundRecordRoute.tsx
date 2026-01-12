import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { mapTableDtoToDomain, type ITableRecordDto } from '@teable/v2-contract-http';
import type { Field, LinkField, Table as TableAggregate } from '@teable/v2-core';

import { formatRecordValue } from '@/components/playground/TableMetaPage';
import { getFieldTypeIcon } from '@/lib/fieldTypeIcons';
import { ArrowLeft, Pencil, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { RecordUpdateDialog } from '@/components/playground/RecordUpdateDialog';
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
import { useOrpcClient } from '@/lib/orpc/OrpcClientContext';
import { usePlaygroundEnvironment } from '@/lib/playground/environment';

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

  const tableResult = useMemo(
    () => (tableQuery.data ? mapTableDtoToDomain(tableQuery.data) : null),
    [tableQuery.data]
  );
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error.message : null;
  const record = recordQuery.data ?? null;
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);

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
            <div className="text-sm text-muted-foreground">Record detail</div>
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
            <RecordDetailCard
              table={table}
              record={record}
              fields={sortedFields}
              baseId={baseId}
              resolveRecordHref={resolveRecordHref}
            />
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
              const FieldIcon = getFieldTypeIcon(fieldType);

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
                        className="text-sm text-primary underline underline-offset-2 hover:text-primary/80"
                        href={resolveRecordHref(targetBaseId, targetTableId, item.id)}
                        target="_blank"
                        rel="noreferrer"
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
                    <div className="flex items-center gap-2">
                      <FieldIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {field.name().toString()}
                    </div>
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
