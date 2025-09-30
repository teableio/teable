/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { useQuery } from '@tanstack/react-query';
import type { IFieldAIConfig } from '@teable/core';
import { FieldType } from '@teable/core';
import { ChevronDown, ChevronRight, HelpCircle, MagicAi } from '@teable/icons';
import { BillingProductLevel, getAIConfig } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';
import {
  cn,
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React, { Fragment, useState } from 'react';
import { AIModelSelect } from '@/features/app/blocks/admin/setting/components/ai-config/AiModelSelect';
import { generateModelKeyList } from '@/features/app/blocks/admin/setting/components/ai-config/utils';
import { RequireCom } from '@/features/app/blocks/setting/components/RequireCom';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { tableConfig } from '@/features/i18n/table.config';
import { UpgradeWrapper } from '../../billing/UpgradeWrapper';
import type { IFieldEditorRo } from '../type';
import { AttachmentFieldAiConfig } from './AttachmentFieldAiConfig';
import { DateFieldAiConfig } from './DateFieldAiConfig';
import { MultipleSelectFieldAiConfig } from './MultipleSelectFieldAiConfig';
import { RatingFieldAiConfig } from './RatingFieldAiConfig';
import { SingleSelectFieldAiConfig } from './SingleSelectFieldAiConfig';
import { TextFieldAiConfig } from './TextFieldAiConfig';

interface FieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

const SUPPORTED_FIELD_TYPES = new Set([
  FieldType.SingleLineText,
  FieldType.LongText,
  FieldType.SingleSelect,
  FieldType.MultipleSelect,
  FieldType.Attachment,
  FieldType.Rating,
  FieldType.Number,
  FieldType.Date,
]);

export const FieldAiConfig: React.FC<FieldAiConfigProps> = ({ field, onChange }) => {
  const { type: fieldType, isLookup, aiConfig } = field;
  const usage = useBaseUsage();
  const baseId = useBaseId() as string;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const [_isExpanded, setIsExpanded] = useState(!!aiConfig);

  const { data: baseAiConfig } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
  });

  const { type } = aiConfig ?? {};
  const { fieldAIEnable = false } = usage?.limit ?? {};
  const isExpanded = _isExpanded && fieldAIEnable;
  const { llmProviders = [], modelDefinationMap } = baseAiConfig ?? {};
  const models = generateModelKeyList(llmProviders);

  const onConfigChange = (key: keyof IFieldAIConfig, value: unknown) => {
    switch (key) {
      case 'modelKey':
        return onChange?.({
          aiConfig: { ...aiConfig, modelKey: value as string } as IFieldAIConfig,
        });
      case 'isAutoFill':
        return onChange?.({
          aiConfig: { ...aiConfig, isAutoFill: value as boolean } as IFieldAIConfig,
        });
      default:
        throw new Error(`Unsupported key: ${key}`);
    }
  };

  const getAiConfigRenderer = () => {
    switch (fieldType) {
      case FieldType.SingleLineText:
      case FieldType.LongText:
        return <TextFieldAiConfig field={field} onChange={onChange} />;
      case FieldType.SingleSelect:
        return <SingleSelectFieldAiConfig field={field} onChange={onChange} />;
      case FieldType.MultipleSelect:
        return <MultipleSelectFieldAiConfig field={field} onChange={onChange} />;
      case FieldType.Attachment:
        return <AttachmentFieldAiConfig field={field} onChange={onChange} />;
      case FieldType.Rating:
      case FieldType.Number:
        return <RatingFieldAiConfig field={field} onChange={onChange} />;
      case FieldType.Date:
        return <DateFieldAiConfig field={field} onChange={onChange} />;
      default:
        throw new Error(`Unsupported field type: ${fieldType}`);
    }
  };

  if (!SUPPORTED_FIELD_TYPES.has(fieldType as FieldType) || isLookup) {
    return null;
  }

  const headerComponent = fieldAIEnable ? (
    <div
      className={cn(
        'group flex cursor-pointer select-none items-center justify-between px-3 py-2 rounded-sm gap-x-2',
        `transition-all duration-500 ease-in-out 
          bg-gradient-to-r from-blue-100/75 via-indigo-100/75 to-purple-100/75
        hover:from-blue-200/60 hover:via-indigo-200/60 hover:to-purple-200/60 
        dark:from-blue-900/75 dark:via-indigo-900/75 dark:to-purple-900/75
        dark:hover:from-blue-800/60 dark:hover:via-indigo-800/60 dark:hover:to-purple-800/60
        `,
        isExpanded && 'rounded-b-none'
      )}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <div className="flex shrink-0 items-center gap-x-1">
        <MagicAi className="size-4 text-amber-500" />
        {t('table:field.aiConfig.title')}
      </div>
      <div className="flex items-center gap-x-3 overflow-hidden">
        {Boolean(aiConfig?.type) && (
          <span
            className="cursor-pointer truncate border-b border-muted-foreground/80 text-xs text-muted-foreground"
            onClick={() => onChange?.({ aiConfig: undefined })}
            tabIndex={0}
            role="button"
          >
            {t('actions.removeConfig')}
          </span>
        )}
        {isExpanded ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
      </div>
    </div>
  ) : (
    <UpgradeWrapper targetBillingLevel={BillingProductLevel.Plus}>
      {({ badge }) => (
        <div className="group flex cursor-pointer select-none items-center justify-between rounded-sm px-3 py-2">
          <div className="flex items-center gap-x-1">
            <MagicAi className="size-4 text-gray-500" />
            {t('table:field.aiConfig.title')}
            {badge}
          </div>
          <ChevronRight className="size-4" />
        </div>
      )}
    </UpgradeWrapper>
  );

  return (
    <Fragment>
      <hr className="border-border" />
      <div
        className={cn('w-full rounded-md border text-sm', fieldAIEnable && 'border-indigo-200/75')}
      >
        {headerComponent}

        {isExpanded && (
          <div className="space-y-2 border-t p-3">
            {getAiConfigRenderer()}
            {type && (
              <Fragment>
                <div className="flex flex-col gap-y-2">
                  <span>
                    {t('table:field.aiConfig.label.model')}
                    <RequireCom />
                  </span>
                  <AIModelSelect
                    value={aiConfig?.modelKey || ''}
                    onValueChange={(newValue) => {
                      onConfigChange('modelKey', newValue);
                    }}
                    options={models}
                    className="w-full px-2"
                    modelDefinationMap={modelDefinationMap}
                    needGroup
                    onlyImageOutput={fieldType === FieldType.Attachment}
                  />
                </div>
                <div className="flex items-center">
                  <Label htmlFor="autoFill" className="font-normal">
                    {t('table:field.aiConfig.autoFill.title')}
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="ml-1 cursor-pointer">
                          <HelpCircle className="size-4" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-[320px]">{t('table:field.aiConfig.autoFill.tip')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Switch
                    id="autoFill"
                    className="ml-2"
                    checked={Boolean(aiConfig?.isAutoFill)}
                    onCheckedChange={(checked) => {
                      onConfigChange('isAutoFill', checked);
                    }}
                  />
                </div>
              </Fragment>
            )}
          </div>
        )}
      </div>
    </Fragment>
  );
};
