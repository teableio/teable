import type { ISelectFieldChoice, ISelectFieldOptions } from '@teable-group/core';
import { ColorUtils, Colors } from '@teable-group/core';
import { PlusCircle } from '@teable-group/icons';
import CloseIcon from '@teable-group/ui-lib/icons/app/close.svg';
import { Input } from '@teable-group/ui-lib/shadcn';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import classNames from 'classnames';
import { useRef, useState } from 'react';

const ChoiceInput: React.FC<{
  reRef: React.Ref<HTMLInputElement>;
  name: string;
  onChange: (name: string) => void;
}> = ({ name, onChange, reRef }) => {
  const [value, setValue] = useState<string>(name);
  return (
    <Input
      ref={reRef}
      className="h-7"
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onChange(value)}
    />
  );
};

export const SelectOptions = (props: {
  options: Partial<ISelectFieldOptions> | undefined;
  isLookup?: boolean;
  onChange?: (options: Partial<ISelectFieldOptions>) => void;
}) => {
  const { options, isLookup, onChange } = props;
  const choices = options?.choices || [];
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const updateOptionChange = (index: number, key: keyof ISelectFieldChoice, value: string) => {
    const newChoice = choices.map((v, i) => {
      if (i === index) {
        return {
          ...v,
          [key]: value,
        };
      }
      return v;
    });
    onChange?.({ choices: newChoice });
  };

  const deleteChoice = (index: number) => {
    onChange?.({
      choices: choices.filter((_, i) => i !== index),
    });
  };

  const addOption = () => {
    const existColors = choices.map((v) => v.color);
    const choice = {
      name: '',
      color: ColorUtils.randomColor(existColors)[0],
    } as ISelectFieldChoice;

    const newChoices = [...choices, choice];
    onChange?.({ choices: newChoices });
    setTimeout(() => {
      console.log(inputRefs.current[choices.length]);
      inputRefs.current[choices.length]?.focus();
    });
  };

  if (isLookup) {
    return <></>;
  }

  return (
    <ul className="space-y-2">
      {choices.map(({ color, name }, i) => {
        return (
          <li key={name} className="flex items-center">
            <Popover>
              <PopoverTrigger>
                <div
                  style={{
                    backgroundColor: ColorUtils.getHexForColor(color),
                  }}
                  className="rounded-full w-4 h-4"
                />
              </PopoverTrigger>
              <PopoverContent className="w-auto">
                <ColorPicker
                  color={color}
                  onSelect={(color) => updateOptionChange(i, 'color', color)}
                />
              </PopoverContent>
            </Popover>
            <div className="flex-1 px-2">
              <ChoiceInput
                reRef={(el) => (inputRefs.current[i] = el)}
                name={name}
                onChange={(value) => updateOptionChange(i, 'name', value)}
              />
            </div>
            <Button
              variant={'ghost'}
              className="h-6 w-6 rounded-full p-0 focus-visible:ring-transparent focus-visible:ring-offset-0"
              onClick={() => deleteChoice(i)}
            >
              <CloseIcon />
            </Button>
          </li>
        );
      })}
      <li className="mt-1">
        <Button
          className="gap-2 font-normal w-full"
          size={'xs'}
          variant={'ghost'}
          onClick={addOption}
        >
          <PlusCircle className="w-4 h-4" />
          Add option
        </Button>
      </li>
    </ul>
  );
};

export const ColorPicker = ({
  color,
  onSelect,
}: {
  color: Colors;
  onSelect: (color: Colors) => void;
}) => {
  const colors = Object.values(Colors);
  return (
    <div className="flex w-80 p-2 flex-wrap">
      {colors.map((col) => (
        <button
          key={col}
          className={classNames('hover:bg-accent p-2 rounded-sm', {
            'bg-ring': color === col,
          })}
          onClick={() => onSelect(col)}
        >
          <div
            style={{
              backgroundColor: ColorUtils.getHexForColor(col),
            }}
            className="rounded-full w-4 h-4"
          ></div>
        </button>
      ))}
    </div>
  );
};
