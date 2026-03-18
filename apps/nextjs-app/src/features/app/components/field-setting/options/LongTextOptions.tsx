import type { ILongTextFieldOptions, ILongTextShowAs } from '@teable/core';
import { Textarea } from '@teable/ui-lib/shadcn';
import { Label } from '@teable/ui-lib/shadcn/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn/ui/tabs';
import { useTranslation } from 'next-i18next';
import { DefaultValue } from '../DefaultValue';

const textFlag = 'text';

export const LongTextOptions = (props: {
  options: Partial<ILongTextFieldOptions> | undefined;
  onChange?: (options: Partial<ILongTextFieldOptions>) => void;
  isLookup?: boolean;
}) => {
  const { isLookup, options, onChange } = props;
  const { t } = useTranslation(['table']);

  const showAs = options?.showAs;
  const selectedType = showAs?.type ?? textFlag;

  const onShowAsChange = (type: string) => {
    const newShowAs = type === textFlag ? null : ({ type } as ILongTextShowAs);
    onChange?.({
      ...options,
      showAs: newShowAs,
    });
  };

  const onDefaultValueChange = (defaultValue: string | undefined) => {
    onChange?.({
      ...options,
      defaultValue: defaultValue ?? null,
    });
  };

  return (
    <div className="form-control space-y-4 border-t pt-4">
      {!isLookup && (
        <>
          <div className="flex w-full flex-col gap-2">
            <Label className="text-sm font-medium">{t('table:field.editor.showAs')}</Label>
            <Tabs value={selectedType} onValueChange={onShowAsChange} className="w-full">
              <TabsList className="flex w-full gap-2">
                <TabsTrigger value={textFlag} className="flex-1 font-normal">
                  {t('table:field.editor.text')}
                </TabsTrigger>
                <TabsTrigger value="markdown" className="flex-1 font-normal">
                  {t('table:field.editor.markdown')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <DefaultValue onReset={() => onDefaultValueChange(undefined)}>
            <Textarea
              className="w-full"
              value={options?.defaultValue || ''}
              onChange={(e) => onDefaultValueChange(e.target.value)}
              rows={3}
            />
          </DefaultValue>
        </>
      )}
    </div>
  );
};
