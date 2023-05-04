import type { SingleSelectFieldOptions } from '@teable-group/core';
import { ColorUtils } from '@teable-group/core';
import CloseIcon from '@teable-group/ui-lib/icons/app/close.svg';
import { useState } from 'react';

export const SelectOptions = (props: {
  options: SingleSelectFieldOptions;
  onChange?: (options: SingleSelectFieldOptions) => void;
}) => {
  const { options, onChange } = props;
  const choices = options.choices || [];
  const [names, setNames] = useState<string[]>(choices.map(({ name }) => name));

  const changeName = (name: string, index: number) => {
    const namesArr = [...names];
    namesArr[index] = name;
    setNames(namesArr);
  };

  const deleteColor = (index: number) => {
    onChange?.({
      choices: choices.filter((_, i) => i === index),
    });
  };

  return (
    <ul>
      {choices.map(({ color, name }, i) => {
        return (
          <li key={name} className="flex items-center">
            <div
              style={{
                backgroundColor: ColorUtils.getHexForColor(color),
              }}
              className="rounded-full w-4 h-4"
            />
            <div className="flex-1 px-2">
              <input
                // eslint-disable-next-line tailwindcss/migration-from-tailwind-2
                className="hover:border-opacity-30 input input-ghost focus:outline-none w-full max-w-xs input-sm"
                type="text"
                value={names[i]}
                onChange={(e) => changeName(e.target.value, i)}
              />
            </div>
            <button className="btn btn-circle btn-ghost btn-sm" onClick={() => deleteColor(i)}>
              <CloseIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
};
