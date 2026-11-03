import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IHttpError } from '@teable/core';
import { hasPermission } from '@teable/core';
import { Check, LayoutGrid } from '@teable/icons';
import {
  duplicateBase,
  duplicateBaseStream,
  getSpaceList,
  type DuplicateBaseProgressCallback,
  type IDuplicateBaseProgressEvent,
  type IDuplicateBaseRo,
  type IGetBaseVo,
} from '@teable/openapi';
import { UsageLimitModalType, useUsageLimitModalStore } from '@teable/sdk/components/billing/store';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  Switch,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import type { IOperationPreviewRequestDto } from '@teable/v2-contract-http/operationPreview';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import {
  OperationPreviewPanel,
  useOperationPreview,
} from '@/features/app/components/operation-preview';
import { getBaseDisplayName } from '@/features/app/utils/base-name';
import { spaceConfig } from '@/features/i18n/space.config';
import { getDuplicateProgressPercent, mergeDuplicateProgress } from './duplicateBaseProgress';
import { useDuplicateBaseStore } from './useDuplicateBaseStore';

type DuplicateBaseMutationParams = IDuplicateBaseRo & {
  useStream: boolean;
  onProgress?: DuplicateBaseProgressCallback;
};

type DuplicateBaseMutationResult =
  | Awaited<ReturnType<typeof duplicateBase>>
  | Awaited<ReturnType<typeof duplicateBaseStream>>;

const DuplicateBase = ({ base }: { base: IGetBaseVo }) => {
  const { closeModal } = useDuplicateBaseStore();
  const [withRecords, setWithRecords] = useState(true);
  const [targetSpaceId, setTargetSpaceId] = useState('');
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [baseName, setBaseName] = useState(
    `${getBaseDisplayName(base.name, t)} (${t('space:baseModal.copy')})`
  );
  const [successDuplicate, setSuccessDuplicate] = useState(false);
  const [newBaseId, setNewBaseId] = useState<string>();
  const [duplicateProgress, setDuplicateProgress] = useState<IDuplicateBaseProgressEvent | null>(
    null
  );
  const useStreamDuplicate = base.v2Status?.useV2 ?? Boolean(base.isCanary);

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((res) => res.data),
  });

  const queryClient = useQueryClient();
  const pendingWriteInput: IDuplicateBaseRo = {
    fromBaseId: base.id,
    spaceId: targetSpaceId,
    name: baseName,
    withRecords,
  };
  const previewRequest: IOperationPreviewRequestDto = {
    operation: 'base.duplicate',
    input: pendingWriteInput,
    options: { detail: 'full' },
  };
  const previewQuery = useOperationPreview(previewRequest, Boolean(targetSpaceId));

  const { mutateAsync: duplicateBaseMutator, isPending: isLoading } = useMutation<
    DuplicateBaseMutationResult,
    IHttpError,
    DuplicateBaseMutationParams
  >({
    mutationFn: ({ useStream, onProgress, ...params }) =>
      useStream ? duplicateBaseStream(params, onProgress) : duplicateBase(params),
    onSuccess: ({ data }) => {
      targetSpaceId &&
        queryClient.invalidateQueries({
          queryKey: ReactQueryKeys.baseList(targetSpaceId),
        });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseAll(),
      });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.recentlyBase(),
      });
      setSuccessDuplicate(true);
      setNewBaseId(data.id);
      setDuplicateProgress((progress) =>
        progress
          ? {
              ...progress,
              phase: 'duplicate_done',
              processedRows: progress.totalRows ?? progress.processedRows,
            }
          : progress
      );
    },
    onError: (error) => {
      setDuplicateProgress(null);
      if (error.status === 402) {
        useUsageLimitModalStore.setState({
          modalType: UsageLimitModalType.Upgrade,
          modalOpen: true,
        });
        return;
      }
      toast.error(error.message);
    },
    // Mutation failures are handled locally, including the upgrade flow.
    meta: { preventGlobalError: true },
  });

  const editableSpaceList = useMemo(() => {
    return spaceList?.filter((space) => hasPermission(space.role, 'base|create')) || [];
  }, [spaceList]);

  const onSubmit = () => {
    if (!targetSpaceId) {
      toast.error(t('space:baseModal.missTargetTip'));
      return;
    }
    if (isLoading || !previewQuery.canConfirm) return;

    setDuplicateProgress(
      useStreamDuplicate
        ? {
            type: 'progress',
            phase: 'structure_creating',
          }
        : null
    );

    duplicateBaseMutator({
      ...pendingWriteInput,
      useStream: useStreamDuplicate,
      onProgress: (_phase, _detail, event) => {
        if (event) {
          setDuplicateProgress((previous) => mergeDuplicateProgress(previous, event));
        }
      },
    });
  };

  useEffect(() => {
    if (!targetSpaceId && editableSpaceList?.length) {
      const currentSpace = editableSpaceList.find((space) => space.id === base.spaceId);
      if (currentSpace) {
        setTargetSpaceId(currentSpace.id);
      } else {
        setTargetSpaceId(editableSpaceList[0].id);
      }
    }
  }, [base.spaceId, editableSpaceList, targetSpaceId]);
  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>
          {t('space:baseModal.duplicate', {
            baseName: getBaseDisplayName(base.name, t),
          })}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col items-center gap-4 py-4">
        {base.icon ? (
          <div className="size-14 min-w-14 text-[3.5rem] leading-none">
            <Emoji emoji={base.icon} size={56} />
          </div>
        ) : (
          <LayoutGrid className="size-14 min-w-14" />
        )}
        <div>
          <Input value={baseName} onChange={(e) => setBaseName(e.target.value)} />
        </div>
      </div>
      <hr />
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Label htmlFor="duplicate-records-mode">{t('space:baseModal.duplicateRecords')}</Label>
          <Switch
            id="duplicate-records-mode"
            checked={withRecords}
            onCheckedChange={(v) => setWithRecords(v)}
          />
        </div>
        <p className="text-xs text-secondary-foreground">
          {t('space:baseModal.duplicateRecordsTip')}
        </p>
        {useStreamDuplicate && isLoading && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between text-xs text-secondary-foreground">
              <span>{t('space:baseModal.copying')}</span>
              <span>{getDuplicateProgressPercent(duplicateProgress)}%</span>
            </div>
            <Progress value={getDuplicateProgressPercent(duplicateProgress)} />
            {duplicateProgress?.tableName && (
              <div className="text-xs text-secondary-foreground">
                {duplicateProgress.tableName}
                {duplicateProgress.processedRows != null && duplicateProgress.totalRows != null
                  ? ` ${duplicateProgress.processedRows}/${duplicateProgress.totalRows}`
                  : null}
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-4">
          <Label htmlFor="username" className="text-end">
            {t('space:baseModal.copyToSpace')}
          </Label>
          <Selector
            candidates={editableSpaceList}
            selectedId={targetSpaceId}
            onChange={(id) => setTargetSpaceId(id)}
          />
        </div>
        {targetSpaceId && (
          <OperationPreviewPanel
            preview={previewQuery.data}
            error={previewQuery.error}
            isLoading={previewQuery.isPending || previewQuery.isFetching}
            onRetry={() => void previewQuery.refetch()}
          />
        )}
      </div>
      <DialogFooter className="mt-4">
        <DialogClose asChild>
          <Button size="sm" type="button" variant="ghost" disabled={isLoading}>
            {t('common:actions.cancel')}
          </Button>
        </DialogClose>
        <Button
          size="sm"
          type="submit"
          onClick={() => {
            if (successDuplicate && newBaseId) {
              closeModal();
              router.push({
                pathname: '/base/[baseId]',
                query: { baseId: newBaseId },
              });
            } else {
              onSubmit();
            }
          }}
          className="flex items-center gap-2"
          disabled={isLoading || (!successDuplicate && !previewQuery.canConfirm)}
        >
          {successDuplicate
            ? t('space:baseModal.duplicateBaseSucceedAndJump')
            : t('space:baseModal.duplicateBase')}

          {successDuplicate && <Check className="size-3 text-green-300" />}

          {isLoading && <Spin className="size-4" />}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
};

export const DuplicateBaseModal = () => {
  const { base, closeModal } = useDuplicateBaseStore();
  return (
    <Dialog open={Boolean(base)} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      {base && <DuplicateBase base={base} />}
    </Dialog>
  );
};
