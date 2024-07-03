import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ColumnFiltersState, SortingState, VisibilityState } from '@tanstack/react-table';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { deleteWebhook, getWebhookList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { ConfirmDialog } from '@teable/ui-lib';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import * as React from 'react';
import { useState } from 'react';
import { webhookConfig } from '@/features/i18n/webhook.config';
import { useDataColumns } from './useDataColumns';

export function DataTable() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const { t } = useTranslation(webhookConfig.i18nNamespaces);
  const { spaceId } = router.query as { spaceId: string };

  const [deleteId, setDeleteId] = useState<string>();
  const [notificationUrl, setNotificationUrl] = useState<string>();

  const { data: webhookList } = useQuery({
    queryKey: ReactQueryKeys.webhookList(spaceId),
    queryFn: ({ queryKey }) => getWebhookList(queryKey[1]).then(({ data }) => data),
  });

  const { mutate: deleteWebhookMutate, isLoading: deleteLoading } = useMutation({
    mutationFn: deleteWebhook,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.webhookList(spaceId) });
      // deleteId &&
      //   (await queryClient.invalidateQueries({
      //     queryKey: ReactQueryKeys.personAccessToken(deleteId),
      //   }));
      setDeleteId(undefined);
    },
  });

  const onEdit = (id: string) => {
    router.push({
      pathname: router.pathname,
      query: { form: 'edit', id },
    });
  };
  const onDelete = (id: string, url: string) => {
    setDeleteId(id);
    setNotificationUrl(url);
  };

  const actionButton = (id: string, url: string) => {
    return (
      <>
        <Button size="sm" type="button" variant="outline" onClick={() => onEdit(id)}>
          Edit
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          className="ml-2"
          onClick={() => onDelete(id, url)}
        >
          Delete
        </Button>
      </>
    );
  };

  const columns = useDataColumns({
    actionChildren: actionButton,
  });
  const table = useReactTable({
    data: webhookList ?? [],
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    columnResizeMode: 'onChange',
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card>
      <CardHeader className="py-4">
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          <div className="flex space-x-2">
            <p>
              Webhooks allow external services to be notified when certain events happen. When the
              specified events happen, we'll send a POST request to each of the URLs you provide.
            </p>
            <div className="flex flex-auto items-end justify-center">
              <Button
                size={'sm'}
                onClick={() =>
                  router.push({
                    pathname: router.asPath,
                    query: { form: 'new' },
                  })
                }
              >
                Add webhook
              </Button>
            </div>
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col p-2">
        <Table>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {t('noResult')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <ConfirmDialog
          contentClassName="max-w-2xl"
          open={Boolean(deleteId)}
          closeable={true}
          onOpenChange={(val) => {
            if (!val) {
              setDeleteId(undefined);
            }
          }}
          title={t('webhook:deleteConfirm.title')}
          description={t('webhook:deleteConfirm.description', { notificationUrl })}
          onCancel={() => setDeleteId(undefined)}
          cancelText={t('common:actions.cancel')}
          confirmText={t('common:actions.confirm')}
          confirmLoading={deleteLoading}
          onConfirm={() => {
            deleteId &&
              deleteWebhookMutate({
                spaceId,
                webhookId: deleteId,
              });
          }}
        />
      </CardContent>
    </Card>
  );
}
