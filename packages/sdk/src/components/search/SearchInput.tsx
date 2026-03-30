import { FieldType } from '@teable/core';
import { AlertCircle, ChevronDown, Search, X } from '@teable/icons';
import { DEFAULT_MAX_SEARCH_FIELD_COUNT } from '@teable/openapi';
import {
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Toggle,
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@teable/ui-lib';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce, useUnmount } from 'react-use';
import { AppContext } from '../../context/app/AppContext';
import { useTranslation } from '../../context/app/i18n';
import { useFieldStaticGetter } from '../../hooks/use-field-static-getter';
import { useFields } from '../../hooks/use-fields';
import { useSearch } from '../../hooks/use-search';

const ALL_FIELDS_ID = 'all_fields';

export function SearchInput({
  className,
  container,
  globalOnly,
}: {
  className?: string;
  container?: HTMLElement;
  globalOnly?: boolean;
}) {
  const { maxSearchFieldCount = DEFAULT_MAX_SEARCH_FIELD_COUNT } = useContext(AppContext) ?? {};
  const fields = useFields();

  const { fieldId, value, setFieldId, setValue, reset, setHideNotMatchRow } = useSearch();
  const filterFields = fields.filter((f) => f.type !== FieldType.Button);
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const { t } = useTranslation();
  const fieldStaticGetter = useFieldStaticGetter();

  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHideNotMatchRow(true);
  }, [setHideNotMatchRow]);

  const [, cancel] = useDebounce(
    () => {
      setValue(inputValue);
    },
    500,
    [inputValue]
  );

  const resetSearch = useCallback(() => {
    cancel();
    setValue();
    setInputValue('');
  }, [cancel, setValue]);

  const isGlobal = fieldId === ALL_FIELDS_ID;

  const selectedFieldIds = useMemo(() => {
    if (!fieldId || isGlobal) return [];
    return fieldId.split(',');
  }, [fieldId, isGlobal]);

  useEffect(() => {
    if (globalOnly) {
      if (fieldId !== ALL_FIELDS_ID) {
        setFieldId(ALL_FIELDS_ID);
      }
      return;
    }
    if (!fieldId) {
      setFieldId(ALL_FIELDS_ID);
    }
  }, [fieldId, fields, globalOnly, setFieldId]);

  useUnmount(() => {
    cancel();
    reset();
  });

  const showAlert = useMemo(() => {
    if (isGlobal) {
      return filterFields.length > maxSearchFieldCount;
    }
    return selectedFieldIds.length > maxSearchFieldCount;
  }, [isGlobal, filterFields.length, selectedFieldIds.length, maxSearchFieldCount]);

  const searchHeader = useMemo(() => {
    if (isGlobal) {
      return t('noun.global');
    }
    const firstField = filterFields.find((f) => f.id === selectedFieldIds[0]);
    const firstName = firstField?.name || t('common.untitled');
    if (selectedFieldIds.length === 1) {
      return firstName;
    }
    if (selectedFieldIds.length > 1) {
      return `${firstName} +${selectedFieldIds.length - 1}`;
    }
    return t('noun.global');
  }, [isGlobal, selectedFieldIds, filterFields, t]);

  const switchChange = useCallback(
    (id: string, checked: boolean) => {
      let newSelectedFields = [...selectedFieldIds];
      if (checked) {
        newSelectedFields.push(id);
      } else {
        newSelectedFields = newSelectedFields.filter((f) => f !== id);
      }
      setFieldId(newSelectedFields.join(','));
    },
    [selectedFieldIds, setFieldId]
  );

  const onModeChange = useCallback(
    (mode: 'global' | 'field') => {
      if (mode === 'global') {
        setFieldId(ALL_FIELDS_ID);
        setFilterText('');
      } else {
        const firstFieldId = filterFields[0]?.id;
        if (firstFieldId) {
          setFieldId(firstFieldId);
        }
      }
    },
    [filterFields, setFieldId]
  );

  const commandFilter = useCallback(
    (fieldId: string, searchValue: string) => {
      const currentField = filterFields.find(
        ({ id }) => fieldId.toLocaleLowerCase() === id.toLocaleLowerCase()
      );
      const name = currentField?.name?.toLocaleLowerCase()?.trim() || t('common.untitled');
      return Number(name.indexOf(searchValue.toLowerCase()) > -1);
    },
    [filterFields, t]
  );

  const showFieldSelector = !globalOnly;

  return (
    <div
      className={cn(
        'left-6 top-60 flex grow h-8 shrink-0 items-center gap-1 overflow-hidden rounded-xl bg-background pr-2 text-sm border outline-muted-foreground',
        {
          'pl-2': globalOnly,
        },
        {
          outline: isFocused,
        },
        className
      )}
    >
      {showFieldSelector && (
        <TooltipProvider>
          <Tooltip>
            <Popover open={selectorOpen} onOpenChange={setSelectorOpen} modal>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  className="flex h-full max-w-[160px] shrink-0 items-center gap-1 rounded-none border-r px-2 text-sm font-normal"
                >
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1">
                      {showAlert && <AlertCircle className="size-3 shrink-0" />}
                      <span className="truncate" title={searchHeader}>
                        {searchHeader}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-w-96 p-1" container={container}>
                <Command filter={commandFilter}>
                  <CommandInput
                    placeholder={t('common.search.placeholder')}
                    className="h-8 text-xs"
                    disabled={isGlobal}
                    value={filterText}
                    onValueChange={setFilterText}
                  />
                  <CommandList className="my-2 max-h-64">
                    <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
                    {filterFields.map((field) => {
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
                          className="flex flex-1 truncate p-0"
                          key={id}
                          value={id}
                          disabled={isGlobal}
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
                                      checked={selectedFieldIds.includes(id) || isGlobal}
                                      onCheckedChange={(checked) => {
                                        switchChange(id, checked);
                                      }}
                                      disabled={
                                        selectedFieldIds.includes(id) &&
                                        selectedFieldIds.length === 1
                                      }
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
                              {selectedFieldIds.includes(id) && selectedFieldIds.length === 1 ? (
                                <TooltipContent>
                                  {t('common.atLeastOne', { noun: t('noun.field') })}
                                </TooltipContent>
                              ) : null}
                            </Tooltip>
                          </TooltipProvider>
                        </CommandItem>
                      );
                    })}
                  </CommandList>

                  <div className="flex items-center justify-around gap-1">
                    <Toggle
                      pressed={isGlobal}
                      onPressedChange={() => onModeChange('global')}
                      size="sm"
                      className="flex flex-1 items-center truncate p-0"
                    >
                      <span className="truncate text-sm">{t('editor.link.globalSearch')}</span>
                    </Toggle>
                    <Toggle
                      pressed={!isGlobal}
                      onPressedChange={() => onModeChange('field')}
                      size="sm"
                      className="flex flex-1 items-center truncate p-0"
                    >
                      <span className="truncate text-sm">{t('editor.link.fieldSearch')}</span>
                    </Toggle>
                  </div>
                </Command>
              </PopoverContent>
            </Popover>
            {showAlert && (
              <TooltipContent>
                <p>{t('editor.link.maxFieldTips', { count: maxSearchFieldCount })}</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      )}
      <input
        key={inputKey}
        ref={ref}
        className="placeholder:text-muted-foregrounds grow rounded-md bg-transparent px-1 outline-none"
        placeholder={t('editor.link.searchPlaceholder')}
        autoComplete="off"
        autoCorrect="off"
        spellCheck="false"
        type="text"
        value={inputValue || ''}
        onChange={(e) => {
          setInputValue(e.target.value);
        }}
        onBlur={() => {
          setIsFocused(false);
          setInputKey((k) => k + 1);
        }}
        onFocus={() => {
          setIsFocused(true);
        }}
      />
      <X
        className={cn('hover:text-primary-foregrounds size-4 cursor-pointer font-light', {
          'opacity-20': !inputValue,
        })}
        onClick={() => {
          resetSearch();
        }}
      />
      <Search className="size-4" />
    </div>
  );
}
