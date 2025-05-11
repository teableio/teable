import type { IRatingFieldRatingAIConfig } from '@teable/core';
import { FieldAIActionType } from '@teable/core';
import { Star } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Textarea } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { FieldSelect } from './components';

interface IRatingFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const RatingFieldAiConfig = (props: IRatingFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { aiConfig } = field;
  const { type } = aiConfig ?? {};

  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Rating,
        icon: <Star className="size-4" />,
        name: t('table:field.aiConfig.type.rating'),
      },
    ];
  }, [t]);

  const onConfigChange = (key: keyof IRatingFieldRatingAIConfig, value: unknown) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as IRatingFieldRatingAIConfig });
      case 'sourceFieldId':
        return onChange?.({
          aiConfig: { ...aiConfig, sourceFieldId: value as string } as IRatingFieldRatingAIConfig,
        });
      case 'attachPrompt':
        return onChange?.({
          aiConfig: {
            ...aiConfig,
            attachPrompt: value as string,
          } as IRatingFieldRatingAIConfig,
        });
      default:
        throw new Error(`Unsupported key: ${key}`);
    }
  };

  return (
    <Fragment>
      <div className="flex flex-col gap-y-2">
        <span>{t('table:field.aiConfig.label.type')}</span>
        <Selector
          className="w-full"
          placeholder={t('table:field.aiConfig.placeholder.type')}
          selectedId={type}
          onChange={(id) => {
            onConfigChange('type', id);
          }}
          candidates={candidates}
        />
      </div>

      {type && type !== FieldAIActionType.Customization && (
        <Fragment>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.aiConfig.label.sourceFieldForClassify')}</span>
            <FieldSelect
              selectedId={(aiConfig as IRatingFieldRatingAIConfig)?.sourceFieldId}
              onChange={(fieldId) => onConfigChange('sourceFieldId', fieldId)}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <span>{t('table:field.aiConfig.label.attachPrompt')}</span>
            <Textarea
              placeholder={t('table:field.aiConfig.placeholder.attachPromptForRating')}
              className="w-full"
              value={(aiConfig as IRatingFieldRatingAIConfig)?.attachPrompt || ''}
              onChange={(e) => {
                onConfigChange('attachPrompt', e.target.value);
              }}
            />
          </div>
        </Fragment>
      )}
    </Fragment>
  );
};
