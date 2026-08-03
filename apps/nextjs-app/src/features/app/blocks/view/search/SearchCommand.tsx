import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FieldType, ViewType } from '@teable/core';
import { HelpCircle, RefreshCcw } from '@teable/icons';
import {
  toggleTableIndex,
  getTableActivatedIndex,
  TableIndex,
  getTableAbnormalIndex,
  repairTableIndex,
  RecommendedIndexRow,
} from '@teable/openapi';
import { LocalStorageKeys } from '@teable/sdk/config';
import {
  useBaseId,
  useFields,
  useFieldStaticGetter,
  useTableId,
  useTablePermission,
  useView,
} from '@teable/sdk/hooks';
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
import type { ReactNode } from 'react';
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

interface ISearchOptionItem {
  id: string;
  label: string;
  tooltip: ReactNode;
  checked?: boolean;
  loading?: boolean;
  extra?: ReactNode;
  onCheckedChange: (checked: boolean) => void | Promise<void>;
}

const SearchOptionItem = (props: ISearchOptionItem) => {
  const { id, label, tooltip, checked, loading, extra, onCheckedChange } = props;

  return (
    <div className="flex h-8 items-center justify-between rounded-md px-2 hover:bg-accent">
      <Label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 truncate text-sm font-medium">
                <span className="truncate" title={label}>
                  {label}
                </span>
                <HelpCircle className="size-4 shrink-0 text-muted-foreground" />
              </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-80 text-wrap break-words">{tooltip}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {extra}
      </Label>

      <div className="ml-2 flex items-center gap-1">
        {loading ? <Spin className="size-3" /> : null}
        <Switch id={id} size="sm" checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </div>
  );
};

export const SearchCommand = forwardRef<ISearchCommandRef, ISearchCommand>((props, ref) => {
  const { onChange, value, hideNotMatchRow, onHideSwitchChange, shareView } = props;
  const { maxSearchFieldCount = Infinity } = useEnv();
  const { t } = useTranslation(['common', 'table']);
  const defaultFields = useFields();
  const fields = defaultFields.filter((f) => f.type !== FieldType.Button);
  const hasSearchFieldLimit = Number.isFinite(maxSearchFieldCount);
  const view = useView();
  const fieldStaticGetter = useFieldStaticGetter();
  const baseId = useBaseId();
  const tableId = useTableId();
  const permission = useTablePermission();
  const editable = permission['table|update'];

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

  const { mutateAsync: toggleIndexFn, isPending: isLoading } = useMutation({
    mutationFn: (type: TableIndex) => toggleTableIndex(baseId!, tableId!, { type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['table-index', tableId] });
    },
  });

  const { mutateAsync: repairIndexFn, isPending: repairIndexLoading } = useMutation({
    mutationFn: (type: TableIndex) => repairTableIndex(baseId!, tableId!, type),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['table-abnormal-index', baseId, tableId, TableIndex.search],
      });
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
            containerClassName="h-10 py-0"
            className="h-8 text-xs"
            disabled={enableGlobalSearch}
            value={filterText}
            onValueChange={(value) => {
              setFilterText(value);
            }}
          />
          <CommandList className="max-h-64 p-2">
            {<CommandEmpty>{t('listEmptyTips')}</CommandEmpty>}
            {fields.map((field) => {
              const {
                id,
                name,
                type,
                isLookup,
                isConditionalLookup,
                aiConfig,
                canReadFieldRecord,
              } = field;
              const { Icon } = fieldStaticGetter(type, {
                isLookup,
                isConditionalLookup,
                hasAiConfig: Boolean(aiConfig),
                deniedReadRecord: !canReadFieldRecord,
              });
              return (
                <CommandItem
                  className={`flex flex-1 truncate p-0 ${
                    enableGlobalSearch ? 'cursor-not-allowed' : ''
                  }`}
                  key={id}
                  value={id}
                  aria-disabled={enableGlobalSearch}
                >
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className={`flex flex-1 items-center truncate p-0 ${
                            enableGlobalSearch ? 'cursor-not-allowed opacity-50' : ''
                          }`}
                        >
                          <Label
                            htmlFor={id}
                            className={`flex h-9 flex-1 items-center gap-2 truncate rounded-md px-2 hover:bg-accent ${
                              enableGlobalSearch ? 'cursor-not-allowed' : 'cursor-pointer'
                            }`}
                          >
                            <Switch
                              id={id}
                              size="sm"
                              checked={selectedFields.includes(id) || enableGlobalSearch}
                              onCheckedChange={(checked) => {
                                switchChange(id, checked);
                              }}
                              disabled={
                                enableGlobalSearch ||
                                (selectedFields.includes(id) && selectedFields.length === 1)
                              }
                            />
                            <Icon className="size-4 shrink-0" />
                            <span className="flex-1 cursor-pointer truncate text-sm" title={name}>
                              {name}
                            </span>
                          </Label>
                        </div>
                      </TooltipTrigger>
                      {enableGlobalSearch ? (
                        <TooltipContent className="max-w-80 text-wrap break-words">
                          {t('table:table.index.globalSearchFieldTip')}
                        </TooltipContent>
                      ) : selectedFields.includes(id) && selectedFields.length === 1 ? (
                        <TooltipContent className="max-w-80 text-wrap break-words">
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

      <div className="flex flex-col gap-0 border-t p-2">
        <SearchOptionItem
          id="search-mode-field"
          label={t('actions.fieldSearch')}
          tooltip={
            hasSearchFieldLimit
              ? t('table:table.index.fieldSearchTip_limited', {
                  count: maxSearchFieldCount,
                })
              : t('table:table.index.fieldSearchTip_infinity')
          }
          checked={!enableGlobalSearch}
          onCheckedChange={(checked) => {
            if (checked) {
              onChange(null);
              return;
            }
            onChange(['all_fields']);
            setFilterText('');
          }}
        />

        {view?.type === ViewType.Grid && (
          <SearchOptionItem
            id="search-hide-not-match-row"
            label={t('actions.hideNotMatchRow')}
            tooltip={t('table:table.index.hideNotMatchRowTip')}
            checked={!!hideNotMatchRow}
            onCheckedChange={(checked) => {
              onHideSwitchChange(checked);
            }}
          />
        )}

        {!shareView && editable && (
          <SearchOptionItem
            id="search-index"
            label={t('actions.tableIndex')}
            tooltip={t('table:table.index.description', { rowCount: RecommendedIndexRow })}
            checked={enabledSearchIndex}
            loading={isLoading}
            extra={
              enabledSearchIndex && !!searchAbnormalIndex?.length ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-0.5">
                        <Button
                          size={'xs'}
                          variant={'outline'}
                          className="flex h-6 items-center gap-1"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (shouldAlert) {
                              setAlertVisible(true);
                              setActionType(ActionType.repair);
                              return;
                            }
                            await repairIndexFn(TableIndex.search);
                          }}
                        >
                          <RefreshCcw className="size-3 text-muted-foreground" />
                          {t('table:table.index.repair')}
                          {repairIndexLoading || getAbnormalLoading ? (
                            <Spin className="size-3" />
                          ) : null}
                        </Button>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-80 text-wrap break-words" sideOffset={5}>
                      {t('table:table.index.repairTip')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null
            }
            onCheckedChange={async (val) => {
              if (val && shouldAlert) {
                setAlertVisible(true);
                setActionType(ActionType.create);
                return;
              }
              baseId && tableId && (await toggleIndexFn(TableIndex.search));
            }}
          />
        )}
      </div>

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
