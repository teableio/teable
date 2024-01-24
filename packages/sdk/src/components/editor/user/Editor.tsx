import type { IUserCellValue } from '@teable-group/core';
import { X } from '@teable-group/icons';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable-group/ui-lib';
import classNames from 'classnames';
import React, { useRef, useState } from 'react';
import type { IUserEditorMainProps } from './EditorMain';
import { UserEditorMain } from './EditorMain';

export const UserEditor = (props: IUserEditorMainProps) => {
  const { value, options, onChange, className, style, readonly } = props;
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLButtonElement>(null);

  const { isMultiple } = options;
  const arrayValue = (isMultiple ? value : value ? [value] : null) as IUserCellValue[];

  const onDelete = (val: IUserCellValue) => {
    const newValue = arrayValue?.filter((v) => v.id !== val.id);
    onChange?.(newValue);
  };

  const onChangeInner = (val?: IUserCellValue | IUserCellValue[]) => {
    onChange?.(val);
    if (!isMultiple) {
      setOpen(false);
    }
  };

  const triggerContent = (
    <Button
      style={style}
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className={classNames(
        'w-full h-auto min-h-[48px] sm:min-h-[48px] flex flex-wrap justify-start hover:bg-transparent gap-2',
        className
      )}
    >
      {arrayValue?.map(({ id, title }) => (
        <div key={id} className="flex items-center">
          <Avatar className="box-content size-7 cursor-pointer border">
            <AvatarImage src={'avatar' as string} alt="avatar-name" />
            <AvatarFallback className="text-sm">{title?.slice(0, 1)}</AvatarFallback>
          </Avatar>
          {/**/}
          <div className="-ml-3 flex items-center overflow-hidden rounded-[6px] bg-secondary pl-4 pr-2 text-sm text-secondary-foreground">
            <p className="flex-1 truncate">{title}</p>
            {!readonly && (
              <X
                className="cursor-pointer opacity-50 hover:opacity-100"
                onClick={(e) => {
                  e.preventDefault();
                  onDelete({ id, title });
                }}
              />
            )}
          </div>
        </div>
      ))}
    </Button>
  );

  return (
    <>
      {readonly ? (
        triggerContent
      ) : (
        <Popover open={open} onOpenChange={setOpen} modal>
          <PopoverTrigger ref={selectRef} asChild>
            {triggerContent}
          </PopoverTrigger>
          <PopoverContent className="p-0" style={{ width: selectRef.current?.offsetWidth || 0 }}>
            <UserEditorMain {...props} onChange={onChangeInner} />
          </PopoverContent>
        </Popover>
      )}
    </>
  );
};
