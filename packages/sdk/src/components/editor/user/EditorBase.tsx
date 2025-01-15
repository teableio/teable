import type { IUserCellValue } from '@teable/core';
import { Check } from '@teable/icons';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Skeleton,
  cn,
} from '@teable/ui-lib';
import { debounce } from 'lodash';
import type { ForwardRefRenderFunction } from 'react';
import {
  useCallback,
  useImperativeHandle,
  useRef,
  forwardRef,
  useState,
  useEffect,
  useMemo,
} from 'react';
import { useTranslation } from '../../../context/app/i18n';
import type { ICellEditor, IEditorRef } from '../type';
import type { ICollaborator } from './types';
import { UserOption } from './UserOption';

export interface IUserEditorBaseProps extends ICellEditor<IUserCellValue | IUserCellValue[]> {
  isMultiple?: boolean;
  onChange?: (value?: IUserCellValue | IUserCellValue[]) => void;
  className?: string;
  onSearch?: (value: string) => void;
  collaborators?: ICollaborator[];
  isLoading?: boolean;
}

export type IUserEditorRef = IEditorRef<IUserCellValue | IUserCellValue[] | undefined>;

const UserEditorBaseRef: ForwardRefRenderFunction<IUserEditorRef, IUserEditorBaseProps> = (
  props,
  ref
) => {
  const {
    value: cellValue,
    style,
    className,
    isLoading,
    isMultiple,
    collaborators,
    onChange,
    onSearch,
  } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [isComposing, setIsComposing] = useState(false);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
    },
  }));

  const onSelect = (value: IUserCellValue) => {
    if (isMultiple) {
      const innerValue = (cellValue || []) as IUserCellValue[];
      const newValue = innerValue.some((v) => v.id === value.id)
        ? innerValue.filter((v) => v.id !== value.id)
        : [...innerValue, value];
      onChange?.(newValue);
      return;
    }
    onChange?.(value.id === (cellValue as IUserCellValue)?.id ? undefined : value);
  };

  const activeStatus = useCallback(
    (value: string) => {
      const originValue = isMultiple
        ? (cellValue as IUserCellValue[])?.map((user) => user?.id)
        : [(cellValue as IUserCellValue)?.id];

      return originValue?.includes(value);
    },
    [cellValue, isMultiple]
  );

  const setApplySearchDebounced = useMemo(() => {
    return onSearch ? debounce(onSearch, 200) : undefined;
  }, [onSearch]);

  useEffect(() => {
    if (!isComposing) {
      setApplySearchDebounced?.(search);
    }
  }, [search, isComposing, onSearch, setApplySearchDebounced]);

  return (
    <Command className={className} style={style} shouldFilter={false}>
      <CommandInput
        ref={inputRef}
        value={search}
        placeholder={t('editor.user.searchPlaceholder')}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onValueChange={(value) => setSearch(value)}
      />
      <CommandList>
        <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
        <CommandGroup aria-valuetext="name">
          {isLoading ? (
            <CommandItem className="flex items-center space-x-4">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </CommandItem>
          ) : (
            collaborators?.map(({ userId, userName, avatar, email }) => (
              <CommandItem
                key={userId}
                value={userName}
                onSelect={() => onSelect({ id: userId, title: userName, avatarUrl: avatar, email })}
                className="flex justify-between"
              >
                <UserOption name={userName} email={email} avatar={avatar} />
                <Check
                  className={cn('ml-2 h-4 w-4', activeStatus(userId) ? 'opacity-100' : 'opacity-0')}
                />
              </CommandItem>
            ))
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

export const UserEditorBase = forwardRef(UserEditorBaseRef);
