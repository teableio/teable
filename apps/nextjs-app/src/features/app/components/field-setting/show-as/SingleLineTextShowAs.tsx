/* eslint-disable @typescript-eslint/naming-convention */
import { SingleLineTextDisplayType } from '@teable-group/core';
import type { ISingleLineTextShowAs } from '@teable-group/core';
import { Button } from '@teable-group/ui-lib/shadcn';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import classNames from 'classnames';

const textFlag = 'text';

export const SINGLE_LINE_TEXT_DISPLAY_INFOS = [
  {
    type: textFlag,
    text: 'Text',
  },
  {
    type: SingleLineTextDisplayType.Url,
    text: 'Url',
  },
  {
    type: SingleLineTextDisplayType.Email,
    text: 'Email',
  },
  {
    type: SingleLineTextDisplayType.Phone,
    text: 'Phone',
  },
];

interface ISingleNumberShowAsProps {
  showAs?: ISingleLineTextShowAs;
  onChange?: (showAs?: ISingleLineTextShowAs) => void;
}

export const SingleTextLineShowAs: React.FC<ISingleNumberShowAsProps> = (props) => {
  const { showAs, onChange } = props;
  const { type } = (showAs || {}) as ISingleLineTextShowAs;
  const selectedType = showAs == null ? textFlag : type;

  const updateDisplayType = (type: string) => {
    const newShowAs =
      type === textFlag
        ? undefined
        : {
            ...showAs,
            type,
          };
    onChange?.(newShowAs as ISingleLineTextShowAs);
  };

  return (
    <div className="flex flex-col gap-2 w-full">
      <Label className="font-normal">Show As</Label>
      <div className="grid grid-cols-4 gap-2">
        {SINGLE_LINE_TEXT_DISPLAY_INFOS.map(({ type, text }) => {
          return (
            <Button
              key={type}
              variant="outline"
              size="sm"
              className={classNames(
                'font-normal',
                type === selectedType &&
                  'bg-foreground text-accent hover:bg-foreground hover:text-accent'
              )}
              onClick={() => updateDisplayType(type)}
            >
              {text}
            </Button>
          );
        })}
      </div>
    </div>
  );
};
