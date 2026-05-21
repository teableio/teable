import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Check, Database } from '@teable/icons';
import {
  duplicateBase,
  duplicateBaseStream,
  getSpaceList,
  type DuplicateBaseProgressCallback,
  type IDuplicateBaseProgressEvent,
  type IDuplicateBaseRo,
  type IGetBaseVo,
} from '@teable/openapi';
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
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { Selector } from '@/components/Selector';
import { Emoji } from '@/features/app/components/emoji/Emoji';
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
  const [targetSpaceId, setTargetSpaceId] = useState<string>();
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const [baseName, setBaseName] = useState(`${base.name} (${t('space:baseModal.copy')})`);
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

  const { mutateAsync: duplicateBaseMutator, isPending: isLoading } = useMutation<
    DuplicateBaseMutationResult,
    Error,
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
      toast.error(error.message);
    },
  });

  const editableSpaceList = useMemo(() => {
    return spaceList?.filter((space) => hasPermission(space.role, 'base|create')) || [];
  }, [spaceList]);

  const onSubmit = () => {
    if (!targetSpaceId) {
      toast.error(t('space:baseModal.missTargetTip'));
      return;
    }

    // toast.message(t('space:baseModal.copying'));

    setDuplicateProgress(
      useStreamDuplicate
        ? {
            type: 'progress',
            phase: 'structure_creating',
          }
        : null
    );

    duplicateBaseMutator({
      fromBaseId: base.id,
      spaceId: targetSpaceId,
      name: baseName,
      withRecords,
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
    <DialogContent className="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>
          {t('space:baseModal.duplicate', {
            baseName: base.name,
          })}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col items-center gap-4 py-4">
        {base.icon ? (
          <div className="size-14 min-w-14 text-[3.5rem] leading-none">
            <Emoji emoji={base.icon} size={56} />
          </div>
        ) : (
          <Database className="size-14 min-w-14" />
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
          <Label htmlFor="username" className="text-right">
            {t('space:baseModal.copyToSpace')}
          </Label>
          <Selector
            candidates={editableSpaceList}
            selectedId={targetSpaceId}
            onChange={(id) => setTargetSpaceId(id)}
          />
        </div>
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
          disabled={isLoading}
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
