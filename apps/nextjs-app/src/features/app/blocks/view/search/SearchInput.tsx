import { Search, X } from '@teable/icons';
import { FieldSelector } from '@teable/sdk/components';
import { useFields, useSearch } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useCallback, useEffect, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useDebounce } from 'react-use';
import { ToolBarButton } from '../tool-bar/ToolBarButton';

export function SearchInput({
  className,
  textClassName,
}: {
  className?: string;
  textClassName?: string;
}) {
  const [active, setActive] = useState(false);
  const fields = useFields();
  const { fieldId, value, setFieldId, setValue } = useSearch();
  const [inputValue, setInputValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);

  useHotkeys(
    [`mod+f`],
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

  const ref = useHotkeys<HTMLInputElement>(
    `esc`,
    () => {
      resetSearch();
      setActive(false);
    },
    {
      enableOnFormTags: ['input'],
    }
  );

  useEffect(() => {
    if (active) {
      ref.current?.focus();
      if (!fieldId) {
        setFieldId(fields[0].id);
      }
    }
  }, [active, fieldId, fields, ref, setFieldId]);

  return active ? (
    <div
      className={cn(
        'left-6 top-60 flex h-7 shrink-0 items-center gap-1 overflow-hidden rounded-xl bg-background p-0 pr-[7px] text-xs border outline-muted-foreground',
        {
          outline: isFocused,
        }
      )}
    >
      <FieldSelector
        className="h-full w-auto gap-1 rounded-none border-0 border-r px-1 text-xs font-normal"
        value={fieldId}
        onSelect={(value) => {
          setFieldId(value);
        }}
      />
      <input
        ref={ref}
        className="placeholder:text-muted-foregrounds flex w-32 rounded-md bg-transparent px-1 outline-none"
        placeholder="Search..."
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
        className="hover:text-primary-foregrounds size-4 cursor-pointer font-light"
        onClick={() => {
          resetSearch();
          setActive(false);
        }}
      />
      <Search className="size-4" />
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
}
