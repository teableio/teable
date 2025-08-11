import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FieldType, ViewType } from '@teable/core';
import { HelpCircle } from '@teable/icons';
import {
  toggleTableIndex,
  getTableActivatedIndex,
  TableIndex,
  getTableAbnormalIndex,
  repairTableIndex,
  RecommendedIndexRow,
} from '@teable/openapi';
import { LocalStorageKeys } from '@teable/sdk/config';
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
  Button,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  Checkbox,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import { useLocalStorage } from 'react-use';
import { useEnv } from '@/features/app/hooks/useEnv';

interface ISearchCommand {
  value: string;
  hideNotMatchRow?: boolean;
  onHideSwitchChange: (hideNotMatchRow?: boolean) => void;
  onChange: (fieldIds: string[] | null) => void;
  shareView?: boolean;
}

export interface ISearchCommandRef {
  toggleSearchIndex: () => Promise<void>;
}

enum ActionType {
  repair = 'repair',
  create = 'create',
}

export const SearchCommand = forwardRef<ISearchCommandRef, ISearchCommand>((props, ref) => {
  const { onChange, value, hideNotMatchRow, onHideSwitchChange, shareView } = props;
  const env = useEnv();
  const { maxSearchFieldCount = Infinity } = env;
  const { t } = useTranslation(['common', 'table']);
  const defaultFields = useFields();
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  const view = useView();
  const fieldStaticGetter = useFieldStaticGetter();
  const baseId = useBaseId();
  const tableId = useTableId();

  const selectedFields = useMemo(() => {
    return value.split(',');
  }, [value]);

  const queryClient = useQueryClient();

  useImperativeHandle(ref, () => ({
    toggleSearchIndex: async () => {
      toggleIndexFn(TableIndex.search);
    },
  }));

  const [alertVisible, setAlertVisible] = useState(false);
  const [shouldAlert, setShouldAlert] = useLocalStorage(LocalStorageKeys.SearchIndexAlert, true);
  const [noPrompt, setNoPrompt] = useState(false);
  const [actionType, setActionType] = useState(ActionType.create);

  const { data: tableActivatedIndex } = useQuery({
    queryKey: ['table-index', tableId],
    queryFn: () => getTableActivatedIndex(baseId!, tableId!).then(({ data }) => data),
    enabled: !shareView,
  });

  const enabledSearchIndex = tableActivatedIndex?.includes(TableIndex.search);

  const { data: searchAbnormalIndex, isLoading: getAbnormalLoading } = useQuery({
    queryKey: ['table-abnormal-index', baseId, tableId, TableIndex.search],
    queryFn: () =>
      getTableAbnormalIndex(baseId!, tableId!, TableIndex.search).then(({ data }) => data),
    enabled: Boolean(enabledSearchIndex && !shareView),
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
      queryClient.invalidateQueries(['table-abnormal-index', baseId, tableId, TableIndex.search]);
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
              const { id, name, type, isLookup, aiConfig, canReadFieldRecord } = field;
              const { Icon } = fieldStaticGetter(type, {
                isLookup,
                hasAiConfig: Boolean(aiConfig),
                deniedReadRecord: !canReadFieldRecord,
              });
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
                            <Icon className="ml-2 size-4 shrink-0" />
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
          <TooltipProvider>
            <Tooltip>
              <Toggle
                pressed={enableGlobalSearch}
                onPressedChange={() => {
                  onChange(['all_fields']);
                  setFilterText('');
                }}
                size={'sm'}
                className="flex flex-1 items-center truncate p-0"
              >
                <TooltipTrigger asChild>
                  <div className="flex size-full flex-1 items-center justify-center truncate p-0">
                    <span
                      className="flex items-center gap-0.5 truncate text-sm"
                      title={t('actions.hideNotMatchRow')}
                    >
                      {t('actions.globalSearch')}
                      <HelpCircle />
                    </span>
                  </div>
                </TooltipTrigger>
              </Toggle>

              <TooltipContent>
                {maxSearchFieldCount !== Infinity
                  ? t('table:table.index.globalSearchTip_limited', {
                      count: maxSearchFieldCount,
                    })
                  : t('table:table.index.globalSearchTip_infinity')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

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

      {!shareView && (
        <div className="flex items-center justify-between pl-1">
          <div className="flex flex-1 items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 text-sm">
                    {t('actions.tableIndex')}
                    <HelpCircle />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-80 text-wrap break-words" sideOffset={5}>
                  {t('table:table.index.description', { rowCount: RecommendedIndexRow })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {enabledSearchIndex && !!searchAbnormalIndex?.length && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-0.5">
                      <Button
                        size={'xs'}
                        variant={'destructive'}
                        className="flex h-6 items-center gap-0.5"
                        onClick={async () => {
                          if (shouldAlert) {
                            setAlertVisible(true);
                            setActionType(ActionType.repair);
                            return;
                          }
                          await repairIndexFn(TableIndex.search);
                        }}
                      >
                        {t('table:table.index.repair')}
                        {repairIndexLoading || getAbnormalLoading ? (
                          <Spin className="size-3" />
                        ) : null}
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-wrap break-words" sideOffset={5}>
                    {t('table:table.index.repairTip')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          <div>
            <Label
              htmlFor={'search-index'}
              className="flex flex-1 cursor-pointer items-center justify-between truncate p-2"
            >
              <div className="flex h-7 items-center gap-1">
                <div className="flex items-center gap-1">
                  {isLoading ? <Spin className="size-3" /> : null}
                  <Switch
                    id={'search-index'}
                    className="scale-75"
                    checked={enabledSearchIndex}
                    onCheckedChange={async (val) => {
                      if (val && shouldAlert) {
                        setAlertVisible(true);
                        setActionType(ActionType.create);
                        return;
                      }
                      baseId && tableId && (await toggleIndexFn(TableIndex.search));
                    }}
                  />
                </div>
              </div>
            </Label>
          </div>
        </div>
      )}

      <AlertDialog open={alertVisible} onOpenChange={setAlertVisible}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table:import.title.tipsTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('table:table.index.enableIndexTip')}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center">
            <Checkbox
              id="noTips"
              checked={noPrompt}
              onCheckedChange={(should: boolean) => {
                setNoPrompt(should);
              }}
            />
            <label
              htmlFor="noTips"
              className="pl-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t('table:import.tips.noTips')}
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('table:import.menu.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (actionType === ActionType.create) {
                  toggleIndexFn(TableIndex.search);
                } else {
                  repairIndexFn(TableIndex.search);
                }
                setShouldAlert(!noPrompt);
              }}
            >
              {t('table:import.title.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Command>
  );
});

SearchCommand.displayName = 'SearchCommand';
