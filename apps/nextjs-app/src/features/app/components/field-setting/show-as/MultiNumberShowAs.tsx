import { ColorUtils, Colors, MultiNumberDisplayType } from '@teable/core';
import type { IMultiNumberShowAs } from '@teable/core';
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { ColorPicker } from '../options/SelectOptions';

const numberFlag = 'Number';

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
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const MULTI_NUMBER_DISPLAY_INFOS = [
    {
      type: numberFlag,
      text: t('table:field.editor.number'),
    },
    {
      type: MultiNumberDisplayType.Bar,
      text: t('table:field.editor.chartBar'),
    },
    {
      type: MultiNumberDisplayType.Line,
      text: t('table:field.editor.chartLine'),
    },
  ];

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
      <Label className="font-normal">{t('table:field.editor.showAs')}</Label>
      <Tabs value={selectedType} onValueChange={updateDisplayType} className="w-full">
        <TabsList className="flex w-full  gap-2">
          {MULTI_NUMBER_DISPLAY_INFOS.map(({ type, text }) => (
            <TabsTrigger key={type} value={type} className="flex-1 font-normal">
              {text}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {showAs != null && (
        <div className="flex h-8 items-center gap-2">
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
          <Label className="font-normal">{t('table:field.editor.color')}</Label>
        </div>
      )}
    </div>
  );
};
