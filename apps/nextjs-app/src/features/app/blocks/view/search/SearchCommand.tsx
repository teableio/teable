import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { HelpCircle } from '@teable/icons';
import {
  toggleTableIndex,
  getTableActivatedIndex,
  TableIndex,
  getTableAbnormalIndex,
  repairTableIndex,
} from '@teable/openapi';
import { useBaseId, useFields, useFieldStaticGetter, useTableId, useView } from '@teable/sdk/hooks';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
  TooltipProvider,
  Tooltip,
  Label,
  TooltipTrigger,
  TooltipContent,
  Switch,
  Toggle,
  Spin,
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  Button,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';

interface ISearchCommand {
  value: string;
  hideNotMatchRow?: boolean;
  onHideSwitchChange: (hideNotMatchRow?: boolean) => void;
  onChange: (fieldIds: string[] | null) => void;
}
export const SearchCommand = (props: ISearchCommand) => {
  const { onChange, value, hideNotMatchRow, onHideSwitchChange } = props;
  const { t } = useTranslation(['common', 'table']);
  const fields = useFields();
  const view = useView();
  const fieldStaticGetter = useFieldStaticGetter();
  const baseId = useBaseId();
  const tableId = useTableId();

  const selectedFields = useMemo(() => {
    return value.split(',');
  }, [value]);

  const queryClient = useQueryClient();

  const { data: tableActivatedIndex } = useQuery({
    queryKey: ['table-index', tableId],
    queryFn: () => getTableActivatedIndex(baseId!, tableId!).then(({ data }) => data),
  });

  const { data: searchAbnormalIndex, isLoading: getAbnormalLoading } = useQuery({
    queryKey: ['table-abnormal-index', baseId, tableId, TableIndex.trgmIndex],
    queryFn: () =>
      getTableAbnormalIndex(baseId!, tableId!, TableIndex.trgmIndex).then(({ data }) => data),
    enabled: !!tableActivatedIndex?.includes(TableIndex.trgmIndex),
  });

  const { mutateAsync: toggleIndexFn, isLoading } = useMutation({
    mutationFn: (type: TableIndex) => toggleTableIndex(baseId!, tableId!, { type }),
    onSuccess: () => {
      queryClient.invalidateQueries(['table-index', tableId]);
    },
  });

  const { mutateAsync: repairIndexFn, isLoading: repairIndexLoading } = useMutation({
    mutationFn: (type: TableIndex) => repairTableIndex(baseId!, tableId!, type),
    onSuccess: () => {
      queryClient.invalidateQueries([
        'table-abnormal-index',
        baseId,
        tableId,
        TableIndex.trgmIndex,
      ]);
    },
  });

  const switchChange = (id: string, checked: boolean) => {
    let newSelectedFields = [...selectedFields];
    if (checked) {
      newSelectedFields.push(id);
    } else {
      newSelectedFields = newSelectedFields.filter((f) => f !== id);
    }
    onChange(newSelectedFields);
  };

  const commandFilter = useCallback(
    (fieldId: string, searchValue: string) => {
      const currentField = fields.find(
        ({ id }) => fieldId.toLocaleLowerCase() === id.toLocaleLowerCase()
      );
      const name = currentField?.name?.toLocaleLowerCase()?.trim() || t('untitled');
      const containWord = name.indexOf(searchValue.toLowerCase()) > -1;
      return Number(containWord);
    },
    [fields, t]
  );

  const enableGlobalSearch = value === 'all_fields';

  const [filterText, setFilterText] = useState('');

  return (
    <Command filter={commandFilter}>
      {
        <>
          <CommandInput
            placeholder={t('actions.search')}
            className="h-8 text-xs"
            disabled={enableGlobalSearch}
            value={filterText}
            onValueChange={(value) => {
              setFilterText(value);
            }}
          />
          <CommandList className="my-2 max-h-64">
            {<CommandEmpty>{t('listEmptyTips')}</CommandEmpty>}
            {fields.map((field) => {
              const { id, name, type, isLookup } = field;
              const { Icon } = fieldStaticGetter(type, isLookup);
              return (
                <CommandItem
                  className="flex flex-1 truncate p-0"
                  key={id}
                  value={id}
                  disabled={enableGlobalSearch}
                >
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex flex-1 items-center truncate p-0">
                          <Label
                            htmlFor={id}
                            className="flex flex-1 cursor-pointer items-center truncate p-2"
                          >
                            <Switch
                              id={id}
                              className="scale-75"
                              checked={selectedFields.includes(id) || enableGlobalSearch}
                              onCheckedChange={(checked) => {
                                switchChange(id, checked);
                              }}
                              disabled={selectedFields.includes(id) && selectedFields.length === 1}
                            />
                            <Icon className="ml-2 shrink-0" />
                            <span
                              className="h-full flex-1 cursor-pointer truncate pl-1 text-sm"
                              title={name}
                            >
                              {name}
                            </span>
                          </Label>
                        </div>
                      </TooltipTrigger>
                      {selectedFields.includes(id) && selectedFields.length === 1 ? (
                        <TooltipContent>
                          {t('atLeastOne', { noun: t('noun.field') })}
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                  </TooltipProvider>
                </CommandItem>
              );
            })}
          </CommandList>
        </>
      }

      <div className="flex flex-col gap-y-1">
        <div className="flex items-center justify-around gap-1">
          <Toggle
            pressed={enableGlobalSearch}
            onPressedChange={() => {
              onChange(['all_fields']);
              setFilterText('');
            }}
            size={'sm'}
            className="flex flex-1 items-center truncate p-0"
          >
            <span className="truncate text-sm" title={t('actions.hideNotMatchRow')}>
              {t('actions.globalSearch')}
            </span>
          </Toggle>

          <Toggle
            pressed={!enableGlobalSearch}
            onPressedChange={() => {
              onChange(null);
            }}
            size={'sm'}
            className="flex flex-1 items-center truncate p-0"
          >
            <span className="truncate text-sm" title={t('actions.hideNotMatchRow')}>
              {t('actions.fieldSearch')}
            </span>
          </Toggle>
        </div>

        {view?.type === ViewType.Grid && (
          <div className="flex items-center justify-around gap-1">
            <Toggle
              pressed={!hideNotMatchRow}
              onPressedChange={() => {
                onHideSwitchChange(false);
              }}
              size={'sm'}
              className="flex flex-1 items-center truncate p-0"
            >
              <span className="truncate text-sm" title={t('actions.hideNotMatchRow')}>
                {t('actions.showAllRow')}
              </span>
            </Toggle>

            <Toggle
              pressed={!!hideNotMatchRow}
              onPressedChange={() => {
                onHideSwitchChange(true);
              }}
              size={'sm'}
              className="flex flex-1 items-center truncate p-0"
            >
              <span className="truncate text-sm" title={t('actions.hideNotMatchRow')}>
                {t('actions.hideNotMatchRow')}
              </span>
            </Toggle>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pl-1">
        <div className="flex flex-1 items-center gap-1">
          <HoverCard>
            <HoverCardTrigger>
              <div className="flex items-center gap-0.5 text-sm">
                {t('actions.tableIndex')}
                <HelpCircle />
              </div>
            </HoverCardTrigger>
            <HoverCardContent className="h-auto w-80 whitespace-normal break-words">
              <span className="text-sm leading-3">{t('table:table.index.description')}</span>
            </HoverCardContent>
          </HoverCard>
          {!!searchAbnormalIndex?.length && (
            <div className="flex items-center gap-0.5">
              <HoverCard>
                <HoverCardTrigger>
                  <Button
                    size={'xs'}
                    variant={'destructive'}
                    className="flex h-6 items-center gap-0.5"
                    onClick={async () => {
                      await repairIndexFn(TableIndex.trgmIndex);
                    }}
                  >
                    {t('table:table.index.repair')}
                    {repairIndexLoading || getAbnormalLoading ? <Spin className="size-3" /> : null}
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent className="h-auto w-80 whitespace-normal break-words">
                  <span className="text-sm leading-3">{t('table:table.index.repairTip')}</span>
                </HoverCardContent>
              </HoverCard>
            </div>
          )}
        </div>

        <div>
          <Label
            htmlFor={'search-index-trgm'}
            className="flex flex-1 cursor-pointer items-center justify-between truncate p-2"
          >
            <div className="flex h-7 items-center gap-1">
              <div className="flex items-center gap-1">
                {isLoading ? <Spin className="size-3" /> : null}
                <Switch
                  id={'search-index-trgm'}
                  className="scale-75"
                  checked={tableActivatedIndex?.includes(TableIndex.trgmIndex)}
                  onCheckedChange={async () => {
                    baseId && tableId && (await toggleIndexFn(TableIndex.trgmIndex));
                  }}
                />
              </div>
            </div>
          </Label>
        </div>
      </div>
    </Command>
  );
};
