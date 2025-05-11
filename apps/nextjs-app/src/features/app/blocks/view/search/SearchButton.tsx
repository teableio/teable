import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ViewType } from '@teable/core';
import { AlertCircle, Search, X } from '@teable/icons';
import {
  getTableActivatedIndex,
  TableIndex,
  RecommendedIndexRow,
  getTableAbnormalIndex,
  repairTableIndex,
  DEFAULT_MAX_SEARCH_FIELD_COUNT,
} from '@teable/openapi';
import { LocalStorageKeys, useView } from '@teable/sdk';
import { useBaseId, useFields, useRowCount, useSearch, useTableId } from '@teable/sdk/hooks';
import { Spin } from '@teable/ui-lib/base';
import {
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Checkbox,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipPortal,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useDebounce, useLocalStorage } from 'react-use';
import { useEnv } from '@/features/app/hooks/useEnv';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import { ToolBarButton } from '../tool-bar/ToolBarButton';
import type { ISearchCommandRef } from './SearchCommand';
import { SearchCommand } from './SearchCommand';
import type { ISearchCountPaginationRef } from './SearchCountPagination';
import { SearchCountPagination } from './SearchCountPagination';

export interface ISearchButtonProps {
  className?: string;
  textClassName?: string;
  shareView?: boolean;
}

export const SearchButton = (props: ISearchButtonProps) => {
  const { className, textClassName, shareView = false } = props;
  const env = useEnv();
  const { maxSearchFieldCount = DEFAULT_MAX_SEARCH_FIELD_COUNT } = env;
  const [active, setActive] = useState(false);
  const fields = useFields();
  const tableId = useTableId();
  const view = useView();
  const viewId = view?.id;
  const rowCount = useRowCount();
  const { fieldId, value, setFieldId, setValue, hideNotMatchRow, setHideNotMatchRow } = useSearch();
  const [alertVisible, setAlertVisible] = useState(false);
  const [shouldAlert, setShouldAlert] = useLocalStorage(LocalStorageKeys.SearchIndexAlert, true);
  const [shouldTips, setShouldTips] = useState(true);
  const [noPrompt, setNoPrompt] = useState(false);
  const baseId = useBaseId();
  const queryClient = useQueryClient();

  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const { t } = useTranslation(['common', 'table']);
  const searchComposition = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const { setSearchCursor, setResetSearchHandler } = useGridSearchStore();
  const [enableGlobalSearch, setEnableGlobalSearch] = useLocalStorage(
    LocalStorageKeys.EnableGlobalSearch,
    true
  );
  const [lsHideNotMatch, setLsHideNotMatchRow] = useLocalStorage<boolean>(
    LocalStorageKeys.SearchHideNotMatchRow,
    false
  );
  const [searchFieldMapCache, setSearchFieldMap] = useLocalStorage<Record<string, string[]>>(
    LocalStorageKeys.TableSearchFieldsCache,
    {}
  );

  const searchCommandRef = useRef<ISearchCommandRef>(null);

  const commandTrigger = useRef<HTMLButtonElement>(null);

  const searchPaginationRef = useRef<ISearchCountPaginationRef>(null);

  const { data: tableActivatedIndex } = useQuery({
    queryKey: ['table-index', tableId],
    queryFn: () => getTableActivatedIndex(baseId!, tableId!).then(({ data }) => data),
    enabled: !shareView,
  });

  const enabledSearchIndex = tableActivatedIndex?.includes(TableIndex.search);

  const { data: searchAbnormalIndex = [] } = useQuery({
    queryKey: ['table-abnormal-index', baseId, tableId, TableIndex.search],
    queryFn: () =>
      getTableAbnormalIndex(baseId!, tableId!, TableIndex.search).then(({ data }) => data),
    enabled: Boolean(enabledSearchIndex && !shareView),
  });

  const { mutateAsync: repairIndexFn, isLoading: repairIndexLoading } = useMutation({
    mutationFn: (type: TableIndex) => repairTableIndex(baseId!, tableId!, type),
    onSuccess: () => {
      queryClient.invalidateQueries(['table-abnormal-index', baseId, tableId, TableIndex.search]);
    },
  });

  useHotkeys(
    `mod+f`,
    (e) => {
      setActive(true);
      ref.current?.focus();
      ref.current?.select();
      e.preventDefault();
    },
    {
      enableOnFormTags: ['input', 'select', 'textarea'],
    }
  );

  const [, cancel] = useDebounce(
    () => {
      if (!searchComposition?.current && inputValue) {
        setValue(inputValue);
      }
    },
    inputValue ? 500 : 0,
    [inputValue]
  );

  const resetSearch = useCallback(() => {
    cancel();
    setValue();
    setInputValue('');
    setSearchCursor(null);
    setActive(false);
  }, [cancel, setSearchCursor, setValue]);

  useEffect(() => {
    setResetSearchHandler(resetSearch);
  }, [resetSearch, setResetSearchHandler]);

  const initSearchParams = useCallback(() => {
    if (!tableId || !viewId || fields.length === 0) {
      return;
    }

    const localSearchKey = `${tableId}-${viewId}`;

    if (view?.type === ViewType.Grid) {
      setHideNotMatchRow(lsHideNotMatch);
    } else {
      // other view type only support filter search, causing the search hit highlight
      setHideNotMatchRow(true);
    }

    if (enableGlobalSearch) {
      setFieldId('all_fields');
      return;
    }

    // set the first field as default search field
    if (!searchFieldMapCache?.[localSearchKey]?.length) {
      const newIds = [fields?.[0].id];
      setFieldId(newIds.join(','));
      setSearchFieldMap({ ...searchFieldMapCache, [localSearchKey]: newIds });
      return;
    }

    const currentFieldIds = fields.map((f) => f.id);
    const fieldIds = searchFieldMapCache[localSearchKey].filter((fieldId) =>
      currentFieldIds.includes(fieldId)
    );
    setFieldId(fieldIds.join(','));

    if (!isEqual(fieldIds, searchFieldMapCache[localSearchKey])) {
      setSearchFieldMap({ ...searchFieldMapCache, [localSearchKey]: fieldIds });
    }
  }, [
    enableGlobalSearch,
    fields,
    lsHideNotMatch,
    searchFieldMapCache,
    setFieldId,
    setHideNotMatchRow,
    setSearchFieldMap,
    tableId,
    view?.type,
    viewId,
  ]);

  useEffect(() => {
    setSearchCursor(null);
  }, [viewId, tableId, setSearchCursor]);

  useEffect(() => {
    if (!inputValue) {
      setValue(inputValue);
    }
  }, [inputValue, setValue]);

  const onFieldChangeHandler = useCallback(
    (fieldIds: string[] | null) => {
      if (!tableId || !viewId) {
        return;
      }
      const localSearchKey = `${tableId}-${viewId}`;
      // change the search mode to field search the default from local cache or the first field
      if (!fieldIds || fields.length === 0) {
        if (searchFieldMapCache?.[localSearchKey]?.length) {
          setFieldId(searchFieldMapCache[localSearchKey].join(','));
        } else {
          const newIds = [fields?.[0].id];
          setFieldId(newIds.join(','));
          setSearchFieldMap({ ...searchFieldMapCache, [tableId]: newIds });
        }
        setEnableGlobalSearch(false);
        return;
      }

      // switch to global search or update search field
      const ids = fieldIds.join(',');
      if (ids === 'all_fields') {
        setEnableGlobalSearch(true);
      } else {
        setEnableGlobalSearch(false);
        setSearchFieldMap({ ...searchFieldMapCache, [localSearchKey]: fieldIds });
        setFieldId(ids);
      }
    },
    [
      fields,
      searchFieldMapCache,
      setEnableGlobalSearch,
      setFieldId,
      setSearchFieldMap,
      tableId,
      viewId,
    ]
  );

  useEffect(() => {
    if (active) {
      ref.current?.focus();
      initSearchParams();
    }
  }, [active, initSearchParams]);

  useHotkeys<HTMLInputElement>(
    `esc`,
    () => {
      if (isFocused) {
        resetSearch();
        setActive(false);
      }
    },
    {
      enableOnFormTags: ['input'],
    }
  );

  const searchHeader = useMemo(() => {
    if (fieldId === 'all_fields') {
      return t('noun.global');
    }
    const fieldIds = fieldId?.split(',') || [];
    const fieldName = fields.find((f) => f.id === fieldIds[0])?.name;
    if (fieldIds.length === 1) {
      return t('table:view.search.field_one', { name: fieldName });
    }
    if (fieldIds.length > 1) {
      return t('table:view.search.field_other', { name: fieldName, length: fieldIds?.length });
    }
  }, [fieldId, fields, t]);

  const showAlert = useMemo(() => {
    if (fieldId === 'all_fields') {
      return fields.length > maxSearchFieldCount;
    }
    const fieldIds = fieldId?.split(',') || [];
    return fieldIds.length > maxSearchFieldCount;
  }, [fieldId, fields, maxSearchFieldCount]);

  return active ? (
    <div
      className={cn(
        'left-6 top-60 flex h-7 shrink-0 items-center gap-1 overflow-hidden rounded-xl bg-background p-0 pr-[7px] text-xs border outline-muted-foreground w-80',
        {
          outline: isFocused,
        }
      )}
    >
      <TooltipProvider>
        <Tooltip>
          <Popover modal>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size={'xs'}
                className="flex w-[64px] shrink-0 items-center justify-center overflow-hidden truncate rounded-none border-r px-px"
                ref={commandTrigger}
              >
                <TooltipTrigger>
                  <div className="flex items-center gap-1">
                    {showAlert && <AlertCircle className="size-3 shrink-0 text-destructive" />}

                    <span
                      className={cn('truncate', {
                        'text-destructive': showAlert,
                      })}
                      title={searchHeader}
                    >
                      {searchHeader}
                    </span>
                  </div>
                </TooltipTrigger>
                {showAlert && (
                  <TooltipPortal>
                    <TooltipContent>
                      <p>
                        {t('table:table.searchTips.maxFieldTips_limited', {
                          count: maxSearchFieldCount,
                        })}
                      </p>
                    </TooltipContent>
                  </TooltipPortal>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="max-w-96 p-1">
              {fieldId && tableId && (
                <SearchCommand
                  value={fieldId}
                  hideNotMatchRow={hideNotMatchRow}
                  onChange={onFieldChangeHandler}
                  shareView={shareView}
                  ref={searchCommandRef}
                  onHideSwitchChange={(checked) => {
                    setLsHideNotMatchRow(checked);
                    setHideNotMatchRow(checked);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        </Tooltip>
      </TooltipProvider>

      <div className="flex flex-1 justify-between overflow-hidden">
        <input
          ref={ref}
          className="placeholder:text-muted-foregrounds min-w-0 grow rounded-md bg-transparent px-1 outline-none"
          placeholder={t('actions.search')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          type="text"
          value={inputValue || ''}
          onCompositionStart={() => {
            searchComposition.current = true;
          }}
          onCompositionEnd={() => {
            searchComposition.current = false;
          }}
          onChange={(e) => {
            if (
              shouldTips &&
              rowCount &&
              rowCount > RecommendedIndexRow &&
              shouldAlert &&
              !shareView &&
              !tableActivatedIndex?.includes(TableIndex.search) &&
              e.target.value
            ) {
              setAlertVisible(true);
              return;
            }
            if (searchAbnormalIndex.length) {
              setAlertVisible(true);
              return;
            }
            setInputValue(e.target.value);
            if (e.target.value === '') {
              setSearchCursor(null);
            }
          }}
          onBlur={() => {
            setIsFocused(false);
          }}
          onFocus={() => {
            setIsFocused(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const actionFn = e.shiftKey
                ? searchPaginationRef?.current?.prevIndex
                : searchPaginationRef?.current?.nextIndex;
              actionFn?.();
            }
          }}
        />
        <div className="flex shrink-0 items-center">
          {view?.type === ViewType.Grid && (
            <SearchCountPagination shareView={shareView} ref={searchPaginationRef} />
          )}

          <X
            className="hover:text-primary-foregrounds size-4 shrink-0 cursor-pointer font-light"
            onClick={() => {
              resetSearch();
              setActive(false);
            }}
          />
          <Search className="size-4 shrink-0" />
        </div>
      </div>

      <AlertDialog open={alertVisible} onOpenChange={setAlertVisible}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('table:import.title.tipsTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {searchAbnormalIndex.length
                ? t('table:table.index.repairTip')
                : t('table:table.index.autoIndexTip', { rowCount: RecommendedIndexRow })}
            </AlertDialogDescription>
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
            <AlertDialogCancel
              onClick={() => {
                setShouldAlert(!noPrompt);
                setShouldTips(false);
              }}
            >
              {searchAbnormalIndex?.length
                ? t('table:table.index.ignoreIndexError')
                : t('table:table.index.keepAsIs')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                if (searchAbnormalIndex?.length) {
                  e.preventDefault();
                  e.stopPropagation();
                  tableId && baseId && (await repairIndexFn(TableIndex.search));
                  setAlertVisible(false);
                  return;
                }
                commandTrigger?.current?.click();
                setTimeout(() => {
                  searchCommandRef?.current?.toggleSearchIndex();
                  setShouldAlert(!noPrompt);
                }, 0);
              }}
            >
              {searchAbnormalIndex?.length
                ? t('table:table.index.repair')
                : t('table:table.index.enableIndex')}
              {repairIndexLoading && <Spin className="size-3" />}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ) : (
    <ToolBarButton
      className={className}
      textClassName={textClassName}
      onClick={() => {
        setActive(true);
      }}
    >
      <Search className="size-4" />
    </ToolBarButton>
  );
};
