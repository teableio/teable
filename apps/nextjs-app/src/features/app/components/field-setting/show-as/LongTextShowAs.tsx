import { LongTextDisplayType } from '@teable/core';
import type { ILongTextShowAs } from '@teable/core';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn/ui/tabs';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

const textFlag = 'plainText';

interface ILongTextShowAsProps {
  showAs?: ILongTextShowAs;
  onChange?: (showAs?: ILongTextShowAs) => void;
}

export const LongTextShowAs: React.FC<ILongTextShowAsProps> = (props) => {
  const { showAs, onChange } = props;
  const { type } = (showAs || {}) as ILongTextShowAs;
  const selectedType = showAs == null ? textFlag : type;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const updateDisplayType = (type: string) => {
    const newShowAs =
      type === textFlag
        ? undefined
        : {
            ...showAs,
            type,
          };
    onChange?.(newShowAs as ILongTextShowAs);
  };

  const LONG_TEXT_DISPLAY_INFOS = [
    {
      type: textFlag,
      text: t('table:field.editor.plainText'),
    },
    {
      type: LongTextDisplayType.Markdown,
      text: t('table:field.editor.markdown'),
    },
  ];

  return (
    <div className="flex w-full flex-col gap-2" data-testid="long-text-show-as">
      <Label className="text-sm font-medium">{t('table:field.editor.showAs')}</Label>
      <Tabs value={selectedType} onValueChange={updateDisplayType} className="w-full">
        <TabsList className="flex w-full gap-2">
          {LONG_TEXT_DISPLAY_INFOS.map(({ type, text }) => (
            <TabsTrigger key={type} value={type} className="flex-1 font-normal">
              {text}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
};
