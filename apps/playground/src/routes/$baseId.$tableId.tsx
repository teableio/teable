import { createTanstackQueryUtils } from '@orpc/tanstack-query';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { mapTableDtoToDomain, type ICreateTableRequestDto } from '@teable/v2-contract-http';
import { FieldId } from '@teable/v2-core';

import { TableMetaPage } from '@/components/playground/TableMetaPage';
import { getOrpcClient } from '@/lib/orpcClient';
import { PLAYGROUND_BASE_NAME, PLAYGROUND_TABLE_ID_STORAGE_KEY } from '@/lib/playground/constants';

export const Route = createFileRoute('/$baseId/$tableId')({ component: PlaygroundTableRoute });

const createFieldId = (): string => {
  const result = FieldId.generate();
  if (result.isOk()) return result.value.toString();
  const fallback = Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  return `fld${fallback}`;
};

const buildBasicTableFields = (): ICreateTableRequestDto['fields'] => {
  const amountFieldId = createFieldId();
  const scoreFieldId = createFieldId();
  const scoreLabelFieldId = createFieldId();

  return [
    {
      type: 'singleLineText',
      name: 'Name',
      options: { showAs: { type: 'email' }, defaultValue: 'owner@example.com' },
    },
    { type: 'longText', name: 'Description', options: { defaultValue: 'Details' } },
    {
      type: 'number',
      id: amountFieldId,
      name: 'Amount',
      options: {
        formatting: { type: 'currency', precision: 2, symbol: '$' },
        showAs: {
          type: 'bar',
          color: 'teal',
          showValue: true,
          maxValue: 100,
        },
        defaultValue: 10,
      },
    },
    {
      type: 'formula',
      id: scoreFieldId,
      name: 'Score',
      options: {
        expression: `{${amountFieldId}} * 2`,
        formatting: { type: 'decimal', precision: 0 },
      },
    },
    {
      type: 'formula',
      id: scoreLabelFieldId,
      name: 'Score Label',
      options: {
        expression: `CONCATENATE("Score: ", {${scoreFieldId}})`,
      },
    },
    {
      type: 'rating',
      name: 'Priority',
      options: { max: 5, icon: 'star', color: 'yellowBright' },
    },
    {
      type: 'singleSelect',
      name: 'Status',
      options: {
        choices: [
          { name: 'Todo', color: 'blue' },
          { name: 'Doing', color: 'yellow' },
          { name: 'Done', color: 'green' },
        ],
        defaultValue: 'Todo',
        preventAutoNewOptions: true,
      },
    },
    {
      type: 'multipleSelect',
      name: 'Tags',
      options: {
        choices: [
          { name: 'Frontend', color: 'purple' },
          { name: 'Backend', color: 'orange' },
          { name: 'Bug', color: 'red' },
        ],
        defaultValue: ['Frontend', 'Bug'],
      },
    },
    { type: 'checkbox', name: 'Done', options: { defaultValue: true } },
    { type: 'attachment', name: 'Files' },
    {
      type: 'date',
      name: 'Due Date',
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        defaultValue: 'now',
      },
    },
    {
      type: 'user',
      name: 'Owner',
      options: { isMultiple: true, shouldNotify: false, defaultValue: ['me'] },
    },
    {
      type: 'button',
      name: 'Action',
      options: {
        label: 'Run',
        color: 'teal',
        maxCount: 3,
        resetCount: true,
        workflow: { id: 'wflaaaaaaaaaaaaaaaa', name: 'Deploy', isActive: true },
      },
    },
  ];
};

const buildBasicTableInput = (baseId: string, name: string): ICreateTableRequestDto => ({
  baseId,
  name,
  fields: buildBasicTableFields(),
});

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
};

function PlaygroundTableRoute() {
  const { baseId, tableId } = Route.useParams();
  const [eventCount, setEventCount] = useState<number | null>(null);
  const navigate = useNavigate();

  const orpc = createTanstackQueryUtils(getOrpcClient());
  const queryClient = useQueryClient();
  const isNewTable = tableId === 'new';

  const tableQuery = useQuery(
    orpc.tables.getById.queryOptions({
      input: {
        baseId,
        tableId,
      },
      enabled: !isNewTable,
      select: (response) => response.data.table,
    })
  );

  const createTableMutation = useMutation(
    orpc.tables.create.mutationOptions({
      onSuccess: (response) => {
        const created = response.data.table;
        setEventCount(response.data.events.length);
        if (typeof window !== 'undefined') {
          localStorage.setItem(PLAYGROUND_TABLE_ID_STORAGE_KEY, created.id);
        }
        queryClient.setQueryData(
          orpc.tables.getById.queryKey({
            input: {
              baseId,
              tableId: created.id,
            },
          }),
          { ok: true, data: { table: created } }
        );
        void queryClient.invalidateQueries({
          queryKey: orpc.tables.list.queryKey({
            input: { baseId },
          }),
        });
        void navigate({
          to: '/$baseId/$tableId',
          params: { baseId, tableId: created.id },
          replace: isNewTable,
        });
      },
    })
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isNewTable) {
      localStorage.setItem(PLAYGROUND_TABLE_ID_STORAGE_KEY, tableId);
    }
  }, [isNewTable, tableId]);

  const tableDto = tableQuery.data ?? null;
  const tableResult = useMemo(() => (tableDto ? mapTableDtoToDomain(tableDto) : null), [tableDto]);
  const table = tableResult?.isOk() ? tableResult.value : null;
  const mappingError = tableResult?.isErr() ? tableResult.error : null;

  const isInitialLoading = !isNewTable && !table && tableQuery.isLoading;
  const isLoading = !isNewTable && tableQuery.isFetching;
  const isCreating = createTableMutation.isPending;
  const errorMessage = (() => {
    if (mappingError) return mappingError;
    if (tableQuery.error) {
      return getErrorMessage(tableQuery.error, 'Failed to load table');
    }
    if (createTableMutation.error) {
      return getErrorMessage(createTableMutation.error, 'Failed to create table');
    }
    return null;
  })();

  const handleCreate = () => {
    createTableMutation.reset();
    createTableMutation.mutate(buildBasicTableInput(baseId, `Playground Table ${Date.now()}`));
  };

  const handleRefresh = () => {
    if (isNewTable) return;
    void tableQuery.refetch();
  };

  return (
    <TableMetaPage
      baseId={baseId}
      baseName={PLAYGROUND_BASE_NAME}
      tableId={tableId}
      table={table}
      eventCount={eventCount}
      isInitialLoading={isInitialLoading}
      isLoading={isLoading}
      isCreating={isCreating}
      errorMessage={errorMessage}
      onRefresh={handleRefresh}
      onCreate={handleCreate}
    />
  );
}
