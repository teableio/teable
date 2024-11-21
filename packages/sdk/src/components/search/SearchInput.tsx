import { Search, X } from '@teable/icons';
import { cn } from '@teable/ui-lib';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebounce, useUnmount } from 'react-use';
import { useTranslation } from '../../context/app/i18n';
import { useFields } from '../../hooks/use-fields';
import { useSearch } from '../../hooks/use-search';
import { FieldSelector } from '../field/FieldSelector';

export function SearchInput({
  className,
  container,
}: {
  className?: string;
  container?: HTMLElement;
}) {
  const fields = useFields();
  const { fieldId, value, setFieldId, setValue, reset, setHideNotMatchRow } = useSearch();
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const { t } = useTranslation();

  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // link search should filter not match row
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

  useEffect(() => {
    if (!fieldId) {
      setFieldId(fields[0]?.id);
    }
  }, [fieldId, fields, setFieldId]);

  useUnmount(() => {
    cancel();
    reset();
  });

  return (
    <div
      className={cn(
        'left-6 top-60 flex grow h-8 shrink-0 items-center gap-1 overflow-hidden rounded-xl bg-background pr-2 text-sm border outline-muted-foreground',
        {
          outline: isFocused,
        },
        className
      )}
    >
      <FieldSelector
        className="h-full w-auto gap-1 rounded-none border-0 border-r px-1 text-sm font-normal"
        value={fieldId}
        container={container}
        onSelect={(value) => {
          setFieldId(value);
        }}
        modal
      />
      <input
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
