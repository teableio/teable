import type { ISelectFieldChoice } from '@teable/core';
import { ColorUtils } from '@teable/core';
import { Popover, PopoverTrigger, Button, PopoverContent, Input } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { ColorPicker } from './ColorPicker';

interface IOptionItemProps {
  choice: ISelectFieldChoice;
  readonly?: boolean;
  onChange: (key: keyof ISelectFieldChoice, value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onInputRef?: (el: HTMLInputElement | null) => void;
}

export const ChoiceItem = (props: IOptionItemProps) => {
  const { choice, readonly, onChange, onKeyDown, onInputRef } = props;
  const { color, name } = choice;
  const bgColor = ColorUtils.getHexForColor(color);

  return (
    <li className="flex grow items-center">
      {readonly ? (
        <div className="h-auto rounded-full border-2 p-[2px]" style={{ borderColor: bgColor }}>
          <div style={{ backgroundColor: bgColor }} className="size-3 rounded-full" />
        </div>
      ) : (
        <Popover>
          <PopoverTrigger>
            <Button
              variant={'ghost'}
              className="h-auto rounded-full border-2 p-[2px]"
              style={{ borderColor: bgColor }}
            >
              <div style={{ backgroundColor: bgColor }} className="size-3 rounded-full" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <ColorPicker color={color} onSelect={(color) => onChange('color', color)} />
          </PopoverContent>
        </Popover>
      )}
      <div className="flex-1 px-2">
        <ChoiceInput
          reRef={(el) => onInputRef?.(el)}
          name={name}
          readOnly={readonly}
          onKeyDown={(e) => onKeyDown?.(e)}
          onChange={(value) => onChange('name', value)}
        />
      </div>
    </li>
  );
};

export const ChoiceInput: React.FC<{
  reRef: React.Ref<HTMLInputElement>;
  readOnly?: boolean;
  name: string;
  onChange: (name: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}> = ({ name, readOnly, onChange, onKeyDown, reRef }) => {
  const [value, setValue] = useState<string>(name);
  const onChangeInner = (e: React.ChangeEvent<HTMLInputElement>) => {
    const curValue = e.target.value;
    setValue(curValue);
  };

  return (
    <Input
      ref={reRef}
      className="h-8"
      type="text"
      value={value}
      readOnly={readOnly}
      onChange={onChangeInner}
      onKeyDown={onKeyDown}
      onBlur={() => onChange(value)}
    />
  );
};
