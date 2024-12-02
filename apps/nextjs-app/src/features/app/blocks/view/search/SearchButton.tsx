import { ViewType } from '@teable/core';
import { Search, X } from '@teable/icons';
import { LocalStorageKeys, useView } from '@teable/sdk';
import { useFields, useSearch, useTableId } from '@teable/sdk/hooks';
import { cn, Popover, PopoverContent, PopoverTrigger, Button } from '@teable/ui-lib/shadcn';
import { isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useDebounce, useLocalStorage } from 'react-use';
import { useGridSearchStore } from '../grid/useGridSearchStore';
import { ToolBarButton } from '../tool-bar/ToolBarButton';
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
  const [active, setActive] = useState(false);
  const fields = useFields();
  const tableId = useTableId();
  const view = useView();
  const viewId = view?.id;
  const { fieldId, value, setFieldId, setValue, hideNotMatchRow, setHideNotMatchRow } = useSearch();

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
  const searchPaginationRef = useRef<ISearchCountPaginationRef>(null);

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
      !searchComposition?.current && setValue(inputValue);
    },
    500,
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

  return active ? (
    <div
      className={cn(
        'left-6 top-60 flex h-7 shrink-0 items-center gap-1 overflow-hidden rounded-xl bg-background p-0 pr-[7px] text-xs border outline-muted-foreground w-80',
        {
          outline: isFocused,
        }
      )}
    >
      <Popover modal>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size={'xs'}
            className="flex w-[64px] shrink-0 items-center justify-center overflow-hidden truncate rounded-none border-r px-px"
          >
            <span className="truncate" title={searchHeader}>
              {searchHeader}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="max-w-96 p-1">
          {fieldId && tableId && (
            <SearchCommand
              value={fieldId}
              hideNotMatchRow={hideNotMatchRow}
              onChange={onFieldChangeHandler}
              onHideSwitchChange={(checked) => {
                setLsHideNotMatchRow(checked);
                setHideNotMatchRow(checked);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
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
