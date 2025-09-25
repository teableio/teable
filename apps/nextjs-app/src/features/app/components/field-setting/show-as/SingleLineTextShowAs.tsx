import { SingleLineTextDisplayType } from '@teable/core';
import type { ISingleLineTextShowAs } from '@teable/core';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn/ui/tabs';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';

const textFlag = 'text';

interface ISingleNumberShowAsProps {
  showAs?: ISingleLineTextShowAs;
  onChange?: (showAs?: ISingleLineTextShowAs) => void;
}

export const SingleTextLineShowAs: React.FC<ISingleNumberShowAsProps> = (props) => {
  const { showAs, onChange } = props;
  const { type } = (showAs || {}) as ISingleLineTextShowAs;
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
    onChange?.(newShowAs as ISingleLineTextShowAs);
  };

  const SINGLE_LINE_TEXT_DISPLAY_INFOS = [
    {
      type: textFlag,
      text: t('table:field.editor.text'),
    },
    {
      type: SingleLineTextDisplayType.Url,
      text: t('table:field.editor.url'),
    },
    {
      type: SingleLineTextDisplayType.Email,
      text: t('table:field.editor.email'),
    },
    {
      type: SingleLineTextDisplayType.Phone,
      text: t('table:field.editor.phone'),
    },
  ];

  return (
    <div className="flex w-full flex-col gap-2" data-testid="text-show-as">
      <Label className="text-sm font-medium">{t('table:field.editor.showAs')}</Label>
      <Tabs value={selectedType} onValueChange={updateDisplayType} className="w-full">
        <TabsList className="flex w-full gap-2">
          {SINGLE_LINE_TEXT_DISPLAY_INFOS.map(({ type, text }) => (
            <TabsTrigger key={type} value={type} className="flex-1 font-normal">
              {text}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
};
