import { ColorUtils, Colors, SingleNumberDisplayType } from '@teable-group/core';
import type { ISingleNumberShowAs } from '@teable-group/core';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from '@teable-group/ui-lib/shadcn';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import classNames from 'classnames';
import { ColorPicker } from '../options/SelectOptions';

const numberFlag = 'Number';

export const SINGLE_NUMBER_DISPLAY_INFOS = [
  {
    type: numberFlag,
    text: 'Number',
  },
  {
    type: SingleNumberDisplayType.Ring,
    text: 'Ring',
  },
  {
    type: SingleNumberDisplayType.Bar,
    text: 'Bar',
  },
];

const defaultShowAsProps = {
  color: Colors.TealBright,
  maxValue: 100,
  showValue: true,
};

interface ISingleNumberShowAsProps {
  showAs?: ISingleNumberShowAs;
  onChange?: (showAs?: ISingleNumberShowAs) => void;
}

export const SingleNumberShowAs: React.FC<ISingleNumberShowAsProps> = (props) => {
  const { showAs, onChange } = props;
  const { type, color, maxValue, showValue } = (showAs || {}) as ISingleNumberShowAs;
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
    onChange?.(newShowAs as ISingleNumberShowAs);
  };

  const updateColor = (color: Colors) => {
    if (showAs == null) return;
    onChange?.({
      ...showAs,
      color,
    });
  };

  const updateMaxValue = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (showAs == null) return;
    const stringValue = e.target.value;
    const maxValue = stringValue === '' ? 0 : Number(stringValue);

    onChange?.({
      ...showAs,
      maxValue,
    });
  };

  const updateShowValue = (checked: boolean) => {
    if (showAs == null) return;
    onChange?.({
      ...showAs,
      showValue: checked,
    });
  };

  return (
    <div className="flex w-full flex-col gap-2" data-testid="single-number-show-as">
      <Label className="font-normal">Show As</Label>
      <div className="flex justify-between">
        {SINGLE_NUMBER_DISPLAY_INFOS.map(({ type, text }) => {
          return (
            <Button
              key={type}
              variant="outline"
              size="sm"
              className={classNames(
                'font-normal w-20',
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
        <>
          <div className="flex items-center justify-between">
            <Label className="font-normal">Max Number</Label>
            <Input defaultValue={maxValue} onChange={updateMaxValue} className="h-8 w-4/6" />
          </div>

          <div className="flex items-center justify-between">
            <Label className="font-normal">Show Number</Label>
            <Switch
              className="h-5 w-9"
              classNameThumb="w-4 h-4 data-[state=checked]:translate-x-4"
              checked={Boolean(showValue)}
              onCheckedChange={updateShowValue}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="font-normal">Color</Label>
            <Popover>
              <PopoverTrigger>
                <div
                  className="ml-4 h-5 w-5 rounded-full p-[2px]"
                  style={{ border: `1px solid ${ColorUtils.getHexForColor(color)}` }}
                >
                  <div
                    className="h-full w-full rounded-full"
                    style={{ backgroundColor: ColorUtils.getHexForColor(color) }}
                  />
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-auto">
                <ColorPicker color={color} onSelect={updateColor} />
              </PopoverContent>
            </Popover>
          </div>
        </>
      )}
    </div>
  );
};
