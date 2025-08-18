import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Database } from '@teable/icons';
import { getBaseAll, getSpaceList, getTableList, moveTable } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useBaseId } from '@teable/sdk/hooks';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  cn,
  DialogPortal,
  DialogFooter,
  Spin,
} from '@teable/ui-lib';
import { groupBy, keyBy, mapValues } from 'lodash';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBaseSideBarStore } from '../base/base-side-bar/store';

interface IBaseSelectPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MoveBaseSelectPanel = (props: IBaseSelectPanelProps) => {
  const { open, onOpenChange } = props;
  const { t } = useTranslation(['common', 'table']);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [isMove, setIsMove] = useState(false);
  const baseId = useBaseId();
  const router = useRouter();
  const [moveTipsOpen, setMoveTipsOpen] = useState(false);
  const { selectTableId: tableId } = useBaseSideBarStore();

  const queryClient = useQueryClient();

  useEffect(() => {
    if (!open) {
      setIsMove(false);
      setSelectedBaseId(null);
    }
  }, [open]);

  const { data: baseList = [] } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll().then((data) => data.data),
  });

  const finalBaseList = baseList.filter((base) => base.id !== baseId);

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const { data: tableList } = useQuery({
    queryKey: ReactQueryKeys.tableList(baseId!),
    queryFn: () => getTableList(baseId!).then((data) => data.data),
    enabled: !!baseId,
  });

  const { mutateAsync: moveTableFn, isLoading } = useMutation({
    mutationFn: () => moveTable(baseId as string, tableId!, { baseId: selectedBaseId! }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.tableList(baseId as string),
      });

      setIsMove(true);

      if (tableList?.length) {
        router.push(
          {
            pathname: `/base/[baseId]/[tableId]`,
            query: { baseId, tableId: tableList[0].id },
          },
          undefined,
          {
            shallow: true,
          }
        );
      } else {
        router.push(
          {
            pathname: `/base/[baseId]`,
            query: { baseId },
          },
          undefined,
          {
            shallow: true,
          }
        );
      }
    },
  });

  const spaceId2NameMap = mapValues(keyBy(spaceList, 'id'), 'name');

  const groupedBaseListMap = groupBy(finalBaseList, 'spaceId');

  const groupedBaseList = Object.values(
    mapValues(groupedBaseListMap, (bases, spaceId) => {
      return {
        spaceId: spaceId,
        spaceName: spaceId2NameMap[spaceId],
        bases: bases,
      };
    })
  );

  const [search, setSearch] = useState('');

  const filteredGroupedBaseList = useMemo(() => {
    return (
      groupedBaseList
        .map((group) => {
          const { bases } = group;
          return {
            ...group,
            bases: search
              ? bases.filter((base) => base.name.toLowerCase().includes(search.toLowerCase()))
              : bases,
          };
        })
        // the spaces has been deleted
        .filter((group) => group.spaceName)
        .filter((group) => group.bases.length > 0)
    );
  }, [groupedBaseList, search]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
        <DialogPortal>
          <DialogContent
            className="flex h-[550px] min-w-[750px] flex-col"
            onPointerDownOutside={(e) => e.preventDefault()}
            onInteractOutside={(e) => e.preventDefault()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>{t('settings.templateAdmin.baseSelectPanel.title')}</DialogTitle>
              <DialogDescription>
                {t('settings.templateAdmin.baseSelectPanel.description')}
              </DialogDescription>
            </DialogHeader>
            <Input
              placeholder={t('settings.templateAdmin.baseSelectPanel.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
            <div className="w-full flex-1 flex-col overflow-y-auto">
              {filteredGroupedBaseList.length > 0 ? (
                <div className="flex w-full flex-col gap-2">
                  {filteredGroupedBaseList.map((group) => (
                    <div key={group.spaceId} className="flex w-full flex-col gap-2">
                      <div className="text-md font-medium">{group.spaceName}</div>
                      <div className="grid w-full grid-cols-4 gap-2">
                        {group.bases.map((base) => (
                          <Button
                            key={base.id}
                            variant={'ghost'}
                            className={cn('truncate w-full flex overflow-hidden gap-1', {
                              'bg-secondary': selectedBaseId === base.id,
                            })}
                            onClick={() => {
                              setSelectedBaseId(base.id);
                            }}
                          >
                            <span className="shrink-0">{base.icon ?? <Database />}</span>
                            <span className="truncate" title={base.name}>
                              {base.name}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex size-full items-center justify-center">
                  {t('common:settings.templateAdmin.noData')}
                </div>
              )}
            </div>
            {!!filteredGroupedBaseList.length && (
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)} variant={'outline'}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  onClick={async () => {
                    if (!isMove) {
                      setMoveTipsOpen(true);
                    } else {
                      router.push(
                        {
                          pathname: `/base/[baseId]/[tableId]`,
                          query: { baseId: selectedBaseId, tableId },
                        },
                        undefined,
                        {
                          shallow: true,
                        }
                      );

                      onOpenChange(false);
                    }
                  }}
                >
                  {!isMove
                    ? t('common:actions.confirm')
                    : t('table:table.actionTips.moveTableSucceedAndJump')}
                  {isMove && <Check className="size-3 text-green-300" />}
                  {isLoading && <Spin />}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </DialogPortal>
      </Dialog>

      <Dialog open={moveTipsOpen} onOpenChange={setMoveTipsOpen}>
        <DialogContent
          className="flex flex-col"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>{t('table:table.moveTableTips.title')}</DialogHeader>
          <div className="w-full flex-1 flex-col overflow-y-auto text-sm">
            {t('table:table.moveTableTips.tips')}
          </div>
          <DialogFooter>
            <Button onClick={() => setMoveTipsOpen(false)} variant={'outline'}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              onClick={async () => {
                if (!tableId) {
                  return;
                }
                await moveTableFn();
                setMoveTipsOpen(false);
              }}
            >
              {t('table:table.moveTableTips.stillContinue')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
