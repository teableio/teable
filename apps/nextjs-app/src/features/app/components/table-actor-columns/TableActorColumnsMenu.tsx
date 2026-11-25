import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IHttpError } from '@teable/core';
import type { ITableActorColumnsVo } from '@teable/openapi';
import { enableTableActorColumns, getTableActorColumns } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button, DropdownMenuItem } from '@teable/ui-lib/shadcn';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

const ACTOR_COLUMNS_POLL_INTERVAL = 3000;

export interface ITableActorColumnsControllerOptions {
  baseId?: string;
  tableId?: string;
  /**
   * The loaded table `table|update` permission. An unresolved permission keeps the entry
   * hidden instead of falling back to a base-level guess.
   */
  canEnable: boolean;
  /** Menu visibility. Status is also fetched while a confirm/dialog is open or a pending op runs. */
  open?: boolean;
}

export interface ITableActorColumnsController {
  canEnable: boolean;
  label: string;
  itemDisabled: boolean;
  itemTitle?: string;
  onClick: () => void;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  confirm: () => void;
  confirmText: string;
  confirmLoading: boolean;
  confirmDisabled: boolean;
  progressText: string | null;
  confirmError: string | null;
}

type Translate = (key: (typeof ACTOR_COLUMNS_LABEL_KEY)[ActorColumnsKind]) => string;

interface IActorColumnsViewInput {
  status?: ITableActorColumnsVo;
  statusErrorMessage?: string;
  requestError: string | null;
  statusUnavailable: boolean;
  isFetching: boolean;
  mutating: boolean;
}

interface IActorColumnsView {
  label: string;
  itemDisabled: boolean;
  itemTitle?: string;
  confirmText: string;
  confirmDisabled: boolean;
  progressText: string | null;
  confirmError: string | null;
}

type ActorColumnsKind = 'unavailable' | 'ready' | 'pending' | 'error' | 'idle';

const ACTOR_COLUMNS_LABEL_KEY = {
  unavailable: 'table:table.actorColumns.reloadStatus',
  ready: 'table:table.actorColumns.enabled',
  pending: 'table:table.actorColumns.pending',
  error: 'table:table.actorColumns.retry',
  idle: 'table:table.actorColumns.enable',
} as const satisfies Record<ActorColumnsKind, string>;

function actorColumnsKind(input: IActorColumnsViewInput): ActorColumnsKind {
  if (input.statusUnavailable) return 'unavailable';
  const state = input.status?.state;
  if (state === 'ready' || state === 'pending' || state === 'error') return state;
  return 'idle';
}

/** Pure presentation of the status VO; no requests, polling or permission logic lives here. */
function describeActorColumns(input: IActorColumnsViewInput, t: Translate): IActorColumnsView {
  const kind = actorColumnsKind(input);
  const pending = kind === 'pending';
  const busy = input.mutating || pending;
  const lastError = input.requestError ?? input.status?.operation?.lastError ?? null;
  const loading = !input.status && kind !== 'unavailable';

  return {
    label: t(ACTOR_COLUMNS_LABEL_KEY[kind]),
    itemDisabled:
      kind !== 'unavailable' && (kind === 'ready' || busy || loading || input.isFetching),
    itemTitle:
      kind === 'unavailable'
        ? input.statusErrorMessage
        : (input.status?.operation?.lastError ?? undefined),
    confirmText: pending
      ? t(ACTOR_COLUMNS_LABEL_KEY.pending)
      : lastError
        ? t(ACTOR_COLUMNS_LABEL_KEY.error)
        : t(ACTOR_COLUMNS_LABEL_KEY.idle),
    confirmDisabled: busy,
    progressText: pending && !lastError ? t(ACTOR_COLUMNS_LABEL_KEY.pending) : null,
    confirmError: kind === 'unavailable' ? null : lastError,
  };
}

/**
 * Status/mutation controller for one table. It owns no menu markup so the confirm dialog can
 * live outside `DropdownMenuContent`: a Radix menu unmounts its subtree on select, which would
 * otherwise drop the dialog and stop polling.
 */
export const useTableActorColumns = (
  options: ITableActorColumnsControllerOptions
): ITableActorColumnsController => {
  const { baseId, tableId, canEnable, open } = options;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // Observed pending operation: keep polling after the menu/dialog closes, until the server
  // reports ready/error. Component unmount ends the interval with the query observer.
  const [pollPending, setPollPending] = useState(false);
  const lastRef = useRef<{ tableKey: string; state?: string }>({ tableKey: '' });

  const enabled = Boolean(canEnable && baseId && tableId);
  const tableKey = `${baseId ?? ''}:${tableId ?? ''}`;
  const queryKey = useMemo(() => ['table-actor-columns', baseId, tableId], [baseId, tableId]);
  const shouldFetch = Boolean(enabled && (open || dialogOpen || pollPending));

  const {
    data: status,
    error: statusError,
    isFetching,
    refetch,
  } = useQuery<ITableActorColumnsVo, IHttpError>({
    queryKey,
    queryFn: () =>
      getTableActorColumns(baseId as string, tableId as string).then((res) => res.data),
    enabled: shouldFetch,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === 'pending' ? ACTOR_COLUMNS_POLL_INTERVAL : false,
  });

  const mutation = useMutation<ITableActorColumnsVo, IHttpError, void>({
    mutationFn: () =>
      enableTableActorColumns(baseId as string, tableId as string).then((res) => res.data),
    meta: { preventGlobalError: true },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setRequestError(null);
      // Accepted pending keeps the dialog open as progress; ready closes it right away.
      if (data.state === 'ready') {
        setDialogOpen(false);
      }
    },
    onError: (error) => setRequestError(error?.message ?? null),
  });

  const state = status?.state;

  useEffect(() => {
    if (lastRef.current.tableKey !== tableKey) {
      lastRef.current = { tableKey };
    }
    if (state === 'ready' || state === 'error') {
      setPollPending(false);
    } else if (state === 'pending') {
      setPollPending(true);
    }
    if (state === 'ready') {
      setDialogOpen(false);
    }
    // One refresh per ready transition for the table this hook currently watches.
    if (state === 'ready' && lastRef.current.state !== 'ready' && baseId) {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.tableList(baseId) });
    }
    lastRef.current.state = state;
  }, [state, tableKey, baseId, queryClient]);
  const confirm = useCallback(() => {
    if (mutation.isPending) return;
    setRequestError(null);
    mutation.mutate();
  }, [mutation]);

  const statusUnavailable = Boolean(statusError) && !status;
  const view = describeActorColumns(
    {
      status,
      statusErrorMessage: statusError?.message,
      requestError,
      statusUnavailable,
      isFetching,
      mutating: mutation.isPending,
    },
    t
  );

  const onClick = () => {
    if (statusUnavailable) {
      void refetch();
      return;
    }
    if (view.itemDisabled) return;
    setRequestError(null);
    setDialogOpen(true);
  };

  return {
    canEnable: enabled,
    label: view.label,
    itemDisabled: view.itemDisabled,
    itemTitle: view.itemTitle,
    onClick,
    dialogOpen,
    setDialogOpen,
    confirm,
    confirmText: view.confirmText,
    confirmLoading: mutation.isPending,
    confirmDisabled: view.confirmDisabled,
    progressText: view.progressText,
    confirmError: view.confirmError,
  };
};
export const TableActorColumnsMenuItem = ({
  controller,
  variant = 'dropdown',
}: {
  controller: ITableActorColumnsController;
  variant?: 'dropdown' | 'list';
}) => {
  if (!controller.canEnable) {
    return null;
  }

  const icon = <ShieldCheck className="size-4" />;

  if (variant === 'list') {
    return (
      <Button
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-none border-b p-3"
        onClick={controller.onClick}
        disabled={controller.itemDisabled}
        title={controller.itemTitle}
      >
        {icon}
        <span className="truncate text-sm font-normal">{controller.label}</span>
      </Button>
    );
  }

  return (
    <DropdownMenuItem
      onClick={controller.onClick}
      disabled={controller.itemDisabled}
      title={controller.itemTitle}
    >
      <span className="me-2 flex size-4 items-center justify-center">{icon}</span>
      <span className="truncate">{controller.label}</span>
    </DropdownMenuItem>
  );
};

export const TableActorColumnsDialog = ({
  controller,
}: {
  controller: ITableActorColumnsController;
}) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!controller.canEnable) {
    return null;
  }

  return (
    <ConfirmDialog
      open={controller.dialogOpen}
      onOpenChange={controller.setDialogOpen}
      title={t('table:table.actorColumns.confirmTitle')}
      content={
        <div className="flex flex-col gap-2 text-sm">
          <p>{t('table:table.actorColumns.confirmDescription')}</p>
          {controller.progressText ? (
            <p className="text-muted-foreground">{controller.progressText}</p>
          ) : null}
          {controller.confirmError ? (
            <p className="text-destructive break-words" title={controller.confirmError}>
              {`${t('table:table.actorColumns.requestFailed')}: ${controller.confirmError}`}
            </p>
          ) : null}
        </div>
      }
      cancelText={t('common:actions.cancel')}
      confirmText={controller.confirmText}
      confirmLoading={controller.confirmLoading}
      confirmDisabled={controller.confirmDisabled}
      onCancel={() => controller.setDialogOpen(false)}
      onConfirm={controller.confirm}
    />
  );
};

/** Resolves the operation-menu inputs so the host component keeps only unconditional calls. */
export function useTableActorColumnsForOperation(
  baseId: string | undefined,
  tableId: string | undefined,
  tableExists: boolean,
  canUpdateTable: boolean,
  open: boolean | undefined,
  fallbackOpen: boolean
): ITableActorColumnsController {
  return useTableActorColumns({
    baseId,
    tableId: tableExists ? tableId : undefined,
    canEnable: Boolean(tableExists && canUpdateTable),
    open: open ?? fallbackOpen,
  });
}
