import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HttpError, Role } from '@teable/core';
import type { ITableSearchAccelerationSwitchRo } from '@teable/openapi';
import {
  SEARCH_ACCELERATION_LARGE_TABLE_CONFIRMATION_REQUIRED,
  getSpaceById,
  getTablePermission,
  getTableSearchAccelerationStatus,
  setTableSearchAcceleration,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

interface IProps {
  baseId: string;
  tableId: string;
  tableName: string;
  spaceId: string;
  onOpenChange: (open: boolean) => void;
}

function useAccelerationPermissions(baseId: string, tableId: string, spaceId: string) {
  const permission = useQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId),
    queryFn: () => getTablePermission(baseId, tableId).then((res) => res.data),
    retry: false,
    meta: { preventGlobalError: true },
  });
  const canUpdateTable = permission.isSuccess && permission.data.table['table|update'];
  const space = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: () => getSpaceById(spaceId).then((res) => res.data),
    enabled: canUpdateTable,
    retry: false,
    meta: { preventGlobalError: true },
  });
  const canManage =
    canUpdateTable &&
    !permission.isFetching &&
    space.isSuccess &&
    !space.isFetching &&
    (space.data.role === Role.Owner || space.data.role === Role.Creator);
  const accessLookup = permission.isError ? permission : space;
  const accessError =
    accessLookup.isError &&
    !(accessLookup.error instanceof HttpError && accessLookup.error.status === 403);
  const readOnly =
    !accessError && !canManage && !permission.isPending && (!canUpdateTable || !space.isPending);
  return { canManage, readOnly, accessError, retryAccess: accessLookup.refetch };
}

export const TableSearchAccelerationDialog = ({
  baseId,
  tableId,
  tableName,
  spaceId,
  onOpenChange,
}: IProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const client = useQueryClient();
  const { canManage, readOnly, accessError, retryAccess } = useAccelerationPermissions(
    baseId,
    tableId,
    spaceId
  );
  const queryKey = ['table-search-acceleration', baseId, tableId];
  const status = useQuery({
    queryKey,
    queryFn: () => getTableSearchAccelerationStatus(baseId, tableId).then((res) => res.data),
    retry: false,
    gcTime: 0,
    refetchInterval: ({ state }) => {
      const intent = state.data?.intentState;
      return intent === 'preparing' || intent === 'disabling' ? 5000 : false;
    },
    meta: { preventGlobalError: true },
  });
  const change = useMutation({
    mutationFn: (request: ITableSearchAccelerationSwitchRo) =>
      setTableSearchAcceleration(baseId, tableId, request),
    retry: false,
    onSettled: () => client.invalidateQueries({ queryKey }),
    meta: { preventGlobalError: true },
  });

  const data = status.isSuccess ? status.data : undefined;
  const state = data?.intentState;
  const canEnable = state === 'disabled';
  const canDisable = state === 'enabled' || state === 'failed';
  // The switch endpoint also returns 409 for competing work and externally managed tables.
  const needsConfirmation =
    canManage &&
    canEnable &&
    change.variables?.enabled &&
    !change.variables.confirmLargeTable &&
    change.error instanceof HttpError &&
    change.error.status === 409 &&
    typeof change.error.data === 'object' &&
    change.error.data !== null &&
    'reason' in change.error.data &&
    change.error.data.reason === SEARCH_ACCELERATION_LARGE_TABLE_CONFIRMATION_REQUIRED;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('table:searchAcceleration.title')}</DialogTitle>
          <DialogDescription className="break-words">{tableName}</DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="space-y-2 text-sm">
          {status.isPending && <p>{t('common:actions.loading')}</p>}
          {status.isError && <p>{t('table:searchAcceleration.statusError')}</p>}
          {data && (
            <>
              <dl className="flex justify-between gap-2">
                <dt>{t('table:searchAcceleration.stateLabel')}</dt>
                <dd className="font-medium">
                  {t(`table:searchAcceleration.state.${data.intentState}`)}
                </dd>
              </dl>
              <p className="text-muted-foreground">
                {t(
                  data.serving
                    ? 'table:searchAcceleration.serving'
                    : 'table:searchAcceleration.notServing'
                )}
              </p>
              {accessError && <p role="alert">{t('table:searchAcceleration.permissionError')}</p>}
              {readOnly && (
                <p className="text-muted-foreground">{t('table:searchAcceleration.readOnly')}</p>
              )}
            </>
          )}
          {needsConfirmation ? (
            <div role="alert" className="space-y-1 rounded-md border p-3">
              <p className="font-medium">{t('table:searchAcceleration.confirmTitle')}</p>
              <p>{t('table:searchAcceleration.confirmDetail')}</p>
            </div>
          ) : (
            change.isError && <p role="alert">{t('table:searchAcceleration.changeError')}</p>
          )}
        </div>
        <DialogFooter>
          {status.isError && (
            <Button variant="outline" onClick={() => status.refetch()} disabled={status.isFetching}>
              {t('common:actions.retry')}
            </Button>
          )}
          {data && accessError && (
            <Button variant="outline" onClick={() => retryAccess()}>
              {t('common:actions.retry')}
            </Button>
          )}
          {needsConfirmation && (
            <>
              <Button variant="outline" onClick={() => change.reset()}>
                {t('common:actions.cancel')}
              </Button>
              <Button onClick={() => change.mutate({ enabled: true, confirmLargeTable: true })}>
                {t('table:searchAcceleration.confirm')}
              </Button>
            </>
          )}
          {canManage && !needsConfirmation && (
            <>
              {canDisable && (
                <Button
                  variant="outline"
                  disabled={change.isPending}
                  onClick={() => change.mutate({ enabled: false })}
                >
                  {t(
                    state === 'failed'
                      ? 'table:searchAcceleration.resetOff'
                      : 'table:searchAcceleration.disable'
                  )}
                </Button>
              )}
              {canEnable && (
                <Button
                  disabled={change.isPending}
                  onClick={() => change.mutate({ enabled: true })}
                >
                  {t('table:searchAcceleration.enable')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
