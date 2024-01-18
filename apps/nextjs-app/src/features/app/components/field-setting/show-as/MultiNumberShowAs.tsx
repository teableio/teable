import { ColorUtils, Colors, MultiNumberDisplayType } from '@teable-group/core';
import type { IMultiNumberShowAs } from '@teable-group/core';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import classNames from 'classnames';
import { ColorPicker } from '../options/SelectOptions';

const numberFlag = 'Number';

export const MULTI_NUMBER_DISPLAY_INFOS = [
  {
    type: numberFlag,
    text: 'Number',
  },
  {
    type: MultiNumberDisplayType.Bar,
    text: 'Chart Bar',
  },
  {
    type: MultiNumberDisplayType.Line,
    text: 'Chart Line',
  },
];

const defaultShowAsProps = {
  color: Colors.TealBright,
};

interface IMultiNumberShowAsProps {
  showAs?: IMultiNumberShowAs;
  onChange?: (showAs?: IMultiNumberShowAs) => void;
}

export const MultiNumberShowAs: React.FC<IMultiNumberShowAsProps> = (props) => {
  const { showAs, onChange } = props;
  const { type, color } = (showAs || {}) as IMultiNumberShowAs;
  const selectedType = showAs == null ? numberFlag : type;

  const updateDisplayType = (type: string) => {
    const newShowAs =
      type === numberFlag
        ? undefined
        : {
            ...defaultShowAsProps,
            ...showAs,
            type,
          };
    onChange?.(newShowAs as IMultiNumberShowAs);
  };

  const updateColor = (color: Colors) => {
    if (showAs == null) return;
    onChange?.({
      ...showAs,
      color,
    });
  };

  return (
    <div className="flex w-full flex-col gap-2" data-testid="multi-number-show-as">
      <Label className="font-normal">Show As</Label>
      <div className="flex justify-between">
        {MULTI_NUMBER_DISPLAY_INFOS.map(({ type, text }) => {
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
      {showAs != null && (
        <div className="flex items-center justify-between">
          <Label className="font-normal">Color</Label>
          <Popover>
            <PopoverTrigger>
              <div
                className="ml-4 size-5 rounded-full p-[2px]"
                style={{ border: `1px solid ${ColorUtils.getHexForColor(color)}` }}
              >
                <div
                  className="size-full rounded-full"
                  style={{ backgroundColor: ColorUtils.getHexForColor(color) }}
                />
              </div>
            </PopoverTrigger>
            <PopoverContent className="w-auto">
              <ColorPicker color={color} onSelect={updateColor} />
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  );
};
