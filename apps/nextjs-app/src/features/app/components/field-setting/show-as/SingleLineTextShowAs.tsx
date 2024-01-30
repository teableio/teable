import { SingleLineTextDisplayType } from '@teable-group/core';
import type { ISingleLineTextShowAs } from '@teable-group/core';
import { Button } from '@teable-group/ui-lib/shadcn';
import { Label } from '@teable-group/ui-lib/shadcn/ui/label';
import classNames from 'classnames';
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
      <Label className="font-normal">{t('table:field.editor.showAs')}</Label>
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
