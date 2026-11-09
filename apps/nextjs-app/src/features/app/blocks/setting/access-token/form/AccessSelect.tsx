import { useQuery } from '@tanstack/react-query';
import { Component, LayoutGrid, Plus } from '@teable/icons';
import type { IGetBaseVo } from '@teable/openapi';
import { getBaseAll, getSharedBase, getSpaceList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useContentDir } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';
import { Emoji } from '@/features/app/components/emoji/Emoji';
import { getBaseDisplayName } from '@/features/app/utils/base-name';
import { AccessList } from './AccessList';

interface IValue {
  spaceIds?: string[];
  baseIds?: string[];
  hasFullAccess?: boolean;
}

interface IFormAccess {
  value?: IValue;
  onChange: (value: IValue) => void;
}

export const AccessSelect = (props: IFormAccess) => {
  const { onChange, value } = props;
  const { t } = useTranslation('token');
  const { t: tCommon } = useTranslation('common');
  const contentDir = useContentDir();
  const [bases, setBases] = useState<string[]>(value?.baseIds || []);
  const [spaces, setSpaces] = useState<string[]>(value?.spaceIds || []);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverContainer = triggerRef.current?.closest<HTMLElement>('[role="dialog"]');

  const { data: spaceList, isLoading: spaceListLoading } = useQuery({
    queryKey: ReactQueryKeys.spaceList(),
    queryFn: () => getSpaceList().then((data) => data.data),
  });

  const { data: baseList, isLoading: baseListLoading } = useQuery({
    queryKey: ['base-all'],
    queryFn: () => getBaseAll().then((data) => data.data),
  });

  const { data: sharedBaseList, isLoading: sharedBaseListLoading } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((data) => data.data),
  });

  const baseMap = useMemo(
    () =>
      baseList?.reduce(
        (acc, cur) => {
          const space = acc[cur.spaceId];
          acc[cur.spaceId] = space ? [...space, cur] : [cur];
          return acc;
        },
        {} as Record<string, IGetBaseVo[]>
      ) ?? {},
    [baseList]
  );

  const onChangeInner = (spaceId?: string, baseId?: string) => {
    onChange({
      ...value,
      spaceIds: spaceId ? [...spaces, spaceId] : spaces,
      baseIds: baseId ? [...bases, baseId] : bases,
    });
  };

  const onDeleteBaseId = (baseId: string) => {
    const newBases = bases.filter((id) => id !== baseId);
    setBases(newBases);
    onChange({
      ...value,
      spaceIds: spaces,
      baseIds: newBases,
    });
  };

  const onDeleteSpaceId = (spaceId: string) => {
    const newSpaces = spaces.filter((id) => id !== spaceId);
    setSpaces(newSpaces);
    onChange({
      ...value,
      spaceIds: newSpaces,
      baseIds: bases,
    });
  };

  if (spaceListLoading || baseListLoading || sharedBaseListLoading) {
    return <Spin className="size-5" />;
  }

  const onFullAccessChange = (hasFullAccess?: boolean) => {
    onChange({
      ...value,
      hasFullAccess,
    });
  };

  const options = [
    { value: 'all', title: t('accessScope.all'), description: t('accessScope.allDescription') },
    { value: 'specific', title: t('accessScope.specific') },
  ];
  const scopeValue = value?.hasFullAccess ? 'all' : 'specific';

  return (
    <div className="space-y-2">
      <RadioGroup
        className="gap-2"
        value={scopeValue}
        onValueChange={(val) => onFullAccessChange(val === 'all')}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
              scopeValue === option.value && 'border-blue-600 ring-2 ring-blue-600/20'
            )}
          >
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <div>
              <div>{option.title}</div>
              {option.description && (
                <div className="text-xs text-muted-foreground">{option.description}</div>
              )}
            </div>
          </label>
        ))}
      </RadioGroup>
      {!value?.hasFullAccess && (
        <div className="space-y-2 ps-7">
          <AccessList
            spaceIds={spaces}
            baseIds={bases}
            onDeleteBaseId={onDeleteBaseId}
            onDeleteSpaceId={onDeleteSpaceId}
          />
          <div className="flex items-center gap-2">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  ref={triggerRef}
                  size={'sm'}
                  variant="outline"
                  role="combobox"
                  aria-expanded={open}
                >
                  <Plus className="size-4 shrink-0" />
                  {t('accessSelect.button')}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                container={popoverContainer}
                align="start"
                // Inside the settings dialog the portal sits in the dialog, so flip against its
                // bounds rather than the viewport, or the list gets clipped at the dialog edge.
                collisionBoundary={popoverContainer}
                collisionPadding={8}
                className="max-h-[min(400px,var(--radix-popover-content-available-height))] w-96 overflow-hidden p-0"
              >
                <Command>
                  <CommandInput placeholder={t('accessSelect.inputPlaceholder')} className="h-9" />
                  <CommandEmpty>{t('accessSelect.empty')}</CommandEmpty>
                  <CommandList>
                    {Boolean(sharedBaseList?.length) && (
                      <CommandGroup
                        heading={
                          <div className="truncate text-sm font-bold">
                            {t('accessSelect.sharedBase')}
                          </div>
                        }
                      >
                        {sharedBaseList
                          ?.filter(({ id: baseId }) => !bases.includes(baseId))
                          ?.map((base) => (
                            <CommandItem
                              key={base.id}
                              value={`${base.id}-${getBaseDisplayName(base.name, tCommon)}`}
                              title={getBaseDisplayName(base.name, tCommon)}
                              onSelect={() => {
                                setBases((prev) => [...prev, base.id]);
                                setOpen(false);
                                onChangeInner(undefined, base.id);
                              }}
                            >
                              <span dir={contentDir}>{getBaseDisplayName(base.name, tCommon)}</span>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    )}
                    {spaceList
                      ?.filter(({ id: spaceId }) => !spaces.includes(spaceId))
                      ?.map(({ id, name }) => (
                        <CommandGroup
                          key={id}
                          heading={<div className="truncate text-sm font-bold">{name}</div>}
                          title={name}
                        >
                          <CommandItem
                            className="gap-1"
                            key={`${id}-all`}
                            value={name}
                            onSelect={() => {
                              setSpaces((prev) => [...prev, id]);
                              setOpen(false);
                              onChangeInner(id);
                            }}
                          >
                            <Component className="size-4 shrink-0" />
                            {t('accessSelect.spaceSelectItem')}
                          </CommandItem>
                          {baseMap[id]
                            ?.filter(({ id: baseId }) => !bases.includes(baseId))
                            ?.map((base) => (
                              <CommandItem
                                className="gap-1"
                                key={base.id}
                                value={`${base.id}-${getBaseDisplayName(base.name, tCommon)}`}
                                title={getBaseDisplayName(base.name, tCommon)}
                                onSelect={() => {
                                  setBases((prev) => [...prev, base.id]);
                                  setOpen(false);
                                  onChangeInner(undefined, base.id);
                                }}
                              >
                                {base.icon ? (
                                  <Emoji className="w-4 shrink-0" emoji={base.icon} size={16} />
                                ) : (
                                  <LayoutGrid className="size-4 shrink-0" />
                                )}
                                <div className="truncate">
                                  {getBaseDisplayName(base.name, tCommon)}
                                </div>
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </div>
  );
};
