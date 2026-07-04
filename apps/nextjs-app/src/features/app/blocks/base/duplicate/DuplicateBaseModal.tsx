import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasPermission } from '@teable/core';
import { Check, Database } from '@teable/icons';
import {
  duplicateBase,
  duplicateBaseCheck,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
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
  // Pre-fetch the cross-space affected fields whenever the target space changes,
  // so the warning is visible up front rather than only after the user clicks
  // duplicate once.
  const { data: previewData } = useQuery({
    queryKey: ['duplicate-base-preview', base.id, targetSpaceId],
    queryFn: () => duplicateBaseCheck(base.id, targetSpaceId as string).then((res) => res.data),
    enabled: Boolean(targetSpaceId),
  });
  const affectedCrossSpace = previewData?.affectedFields?.length
    ? previewData.affectedFields
    : null;

  const affectedByTable = useMemo(() => {
    if (!affectedCrossSpace) return null;
    const groups = new Map<string, { tableName: string; fields: typeof affectedCrossSpace }>();
    for (const f of affectedCrossSpace) {
      const existing = groups.get(f.tableId);
      if (existing) {
        existing.fields.push(f);
      } else {
        groups.set(f.tableId, { tableName: f.tableName, fields: [f] });
      }
    }
    return Array.from(groups.entries()).map(([tableId, value]) => ({
      tableId,
      ...value,
    }));
  }, [affectedCrossSpace]);

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
      toast.error(error.message);
    },
    // Suppress the global validation toast — we render the affected fields inline.
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
        {affectedByTable && (
          <div className="rounded-md border border-yellow-300 bg-yellow-50 p-2.5 text-xs text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-200">
            <p className="font-medium">{t('space:crossSpace.duplicateBaseTitle')}</p>
            <p className="mt-1">
              {t('space:crossSpace.duplicateBaseDescription', {
                count: affectedCrossSpace?.length ?? 0,
              })}
            </p>
            <Accordion
              type="multiple"
              className="mt-2 max-h-60 overflow-y-auto"
              aria-label={t('space:crossSpace.duplicateBaseTitle')}
            >
              {affectedByTable.map((group) => (
                <AccordionItem key={group.tableId} value={group.tableId} className="border-b-0">
                  <AccordionTrigger
                    aria-label={t('space:crossSpace.affectedTableSuffix', {
                      count: group.fields.length,
                    })}
                    className="py-1.5 text-xs font-normal hover:no-underline"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                      <span className="truncate font-medium">{group.tableName}</span>
                      <span className="ml-1 shrink-0 rounded bg-yellow-200/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none text-yellow-900 dark:bg-yellow-800/60 dark:text-yellow-100">
                        {group.fields.length}
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent innerClassName="pb-1.5 pt-0">
                    <div className="flex flex-wrap gap-1">
                      {group.fields.map((f) => (
                        <span
                          key={f.fieldId}
                          className="inline-flex items-center rounded border border-yellow-300/60 bg-background/70 px-1.5 py-0.5 text-[11px] dark:border-yellow-700/60 dark:bg-yellow-950/40"
                        >
                          {f.fieldName}
                        </span>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
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
          disabled={isLoading}
        >
          {successDuplicate
            ? t('space:baseModal.duplicateBaseSucceedAndJump')
            : affectedCrossSpace
              ? t('space:crossSpace.convertAndDuplicate')
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
