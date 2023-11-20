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
  const { value, options, onChange, className, style, disabled } = props;
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

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger ref={selectRef} asChild disabled={disabled}>
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
              <Avatar className="box-content h-7 w-7 cursor-pointer border">
                <AvatarImage src={'avatar' as string} alt="avatar-name" />
                <AvatarFallback className="text-sm">{title?.slice(0, 1)}</AvatarFallback>
              </Avatar>
              {/**/}
              <div className="bg-secondary text-secondary-foreground -ml-3 flex items-center overflow-hidden rounded-[6px] pl-4 pr-2 text-sm">
                <p className="flex-1 truncate">{title}</p>
                <X
                  className="cursor-pointer opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.preventDefault();
                    onDelete({ id, title });
                  }}
                />
              </div>
            </div>
          ))}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0" style={{ width: selectRef.current?.offsetWidth || 0 }}>
        <UserEditorMain {...props} onChange={onChangeInner} />
      </PopoverContent>
    </Popover>
  );
};
