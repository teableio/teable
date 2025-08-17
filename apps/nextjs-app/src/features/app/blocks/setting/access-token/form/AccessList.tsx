import { useQuery } from '@tanstack/react-query';
import { Component, Database, X } from '@teable/icons';
import type { IGetBaseVo, IGetSpaceVo } from '@teable/openapi';
import { getBaseAll, getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button } from '@teable/ui-lib/shadcn';
import { isEmpty } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';

interface IAccessListProps {
  baseIds?: string[];
  spaceIds?: string[];
  hasFullAccess?: boolean;
  onDeleteFullAccess: () => void;
  onDeleteBaseId: (baseId: string) => void;
  onDeleteSpaceId: (spaceId: string) => void;
}

export const AccessList = (props: IAccessListProps) => {
  const { baseIds, spaceIds, hasFullAccess, onDeleteBaseId, onDeleteSpaceId, onDeleteFullAccess } =
    props;
  const { t } = useTranslation('token');

  const { data: spaceList } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });
  const { data: baseList } = useQuery({
    queryKey: ReactQueryKeys.baseAll(),
    queryFn: () => getBaseAll().then((data) => data.data),
  });
  const spaceMap = useMemo(() => {
    const spaceMap: Record<string, IGetSpaceVo> = {};
    spaceList?.forEach((item) => {
      spaceMap[item.id] = item;
    });
    return spaceMap;
  }, [spaceList]);

  const baseMap = useMemo(() => {
    const baseMap: Record<string, IGetBaseVo> = {};
    baseList?.forEach((item) => {
      baseMap[item.id] = item;
    });
    return baseMap;
  }, [baseList]);

  const { displaySpaceMap, displayBaseMap, allDisplaySpaceIds } = useMemo(() => {
    if (isEmpty(baseMap) && isEmpty(spaceMap)) {
      return { displayBaseMap: {}, displaySpaceMap: {}, allDisplaySpaceIds: [] };
    }
    const displaySpaceMap: Record<string, IGetSpaceVo> = {};
    const displayBaseMap: Record<string, IGetBaseVo[]> = {};
    const allDisplaySpaceIds = new Set<string>();
    spaceIds?.forEach((spaceId) => {
      displaySpaceMap[spaceId] = spaceMap[spaceId];
      allDisplaySpaceIds.add(spaceId);
    });

    baseIds?.forEach((baseId) => {
      const base = baseMap[baseId];
      if (!base) {
        return;
      }
      const cur = displayBaseMap[base.spaceId];
      allDisplaySpaceIds.add(base.spaceId);
      displayBaseMap[base.spaceId] = cur ? [...cur, base] : [base];
    });

    return { displayBaseMap, displaySpaceMap, allDisplaySpaceIds: Array.from(allDisplaySpaceIds) };
  }, [spaceIds, baseIds, spaceMap, baseMap]);

  return (
    <div className="pl-1 text-sm">
      {hasFullAccess && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('accessSelect.fullAccess.title')}</div>

          <div className="flex h-8 items-center justify-between">
            <div className="flex items-center gap-2">
              <Component className="size-4 shrink-0" />
              {t('accessSelect.fullAccess.description')}
            </div>
            <Button variant={'ghost'} size={'sm'} onClick={() => onDeleteFullAccess()}>
              <X />
            </Button>
          </div>
        </div>
      )}
      {allDisplaySpaceIds.map((spaceId) => {
        const space = spaceMap[spaceId];
        const displaySpace = displaySpaceMap[spaceId];
        const displayBases = displayBaseMap[spaceId];
        return (
          <div key={spaceId} className="space-y-1">
            <div className="text-xs text-muted-foreground">{space?.name}</div>
            <div>
              {displaySpace && (
                <div className="flex h-8 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Component className="size-4 shrink-0" />
                    {t('allSpace')}
                  </div>
                  <Button
                    variant={'ghost'}
                    size={'sm'}
                    onClick={() => onDeleteSpaceId(displaySpace.id)}
                  >
                    <X />
                  </Button>
                </div>
              )}
              {displayBases?.map((base) => (
                <div key={base.id} className="flex h-8 items-center justify-between">
                  <div className="flex items-center gap-2">
                    {base.icon ? (
                      <Emoji className="w-4 shrink-0" emoji={base.icon} size={16} />
                    ) : (
                      <Database className="size-4 shrink-0" />
                    )}
                    {base.name}
                  </div>
                  <Button variant={'ghost'} size={'sm'} onClick={() => onDeleteBaseId(base.id)}>
                    <X />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
