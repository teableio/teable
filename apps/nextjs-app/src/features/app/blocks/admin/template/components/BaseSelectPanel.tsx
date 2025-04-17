import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Database } from '@teable/icons';
import type { IGetBaseVo, IGetSpaceVo } from '@teable/openapi';
import { updateTemplate } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Button,
  Input,
  cn,
} from '@teable/ui-lib';
import { groupBy, keyBy, mapValues } from 'lodash';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface IBaseSelectPanelProps {
  baseId?: string;
  baseList: IGetBaseVo[];
  templateId: string;
  spaceList: IGetSpaceVo[];
  disabled?: boolean;
}

export const BaseSelectPanel = (props: IBaseSelectPanelProps) => {
  const { baseId, baseList, templateId, spaceList, disabled } = props;
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);

  const queryClient = useQueryClient();

  const spaceId2NameMap = mapValues(keyBy(spaceList, 'id'), 'name');

  const groupedBaseListMap = groupBy(baseList, 'spaceId');

  const groupedBaseList = Object.values(
    mapValues(groupedBaseListMap, (bases, spaceId) => {
      return {
        spaceId: spaceId,
        spaceName: spaceId2NameMap[spaceId],
        bases: bases,
      };
    })
  );

  const { mutateAsync: updateTemplateFn } = useMutation({
    mutationFn: (baseId: string) => updateTemplate(templateId, { baseId }),
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.templateList());
      setOpen(false);
    },
  });

  const baseName = useMemo(() => {
    return baseId
      ? baseList.find((base) => base.id === baseId)?.name
      : t('settings.templateAdmin.baseSelectPanel.selectBase');
  }, [baseId, baseList, t]);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={'xs'}
          className={cn('w-32 overflow-hidden', {
            'border-red-500': !baseName,
          })}
          disabled={disabled}
        >
          {baseName ?? (
            <span
              className="truncate text-red-500"
              title={t('settings.templateAdmin.baseSelectPanel.abnormalBase')}
            >
              {t('settings.templateAdmin.baseSelectPanel.abnormalBase')}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[550px] min-w-[750px] flex-col">
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
                        'bg-secondary': baseId === base.id,
                      })}
                      onClick={() => updateTemplateFn(base.id)}
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
        </div>
      </DialogContent>
    </Dialog>
  );
};
