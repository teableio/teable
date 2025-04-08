/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { useQuery } from '@tanstack/react-query';
import type { IFieldAIConfig } from '@teable/core';
import { FieldType } from '@teable/core';
import { ChevronDown, ChevronRight, HelpCircle } from '@teable/icons';
import { getAIConfig } from '@teable/openapi';
import { MagicAI } from '@teable/sdk/components/comment/comment-editor/plate-ui/icons';
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
import { generateModelKeyList } from '@/features/app/blocks/admin/setting/components/ai-config/util';
import { tableConfig } from '@/features/i18n/table.config';
import type { IFieldEditorRo } from '../type';
import { MultipleSelectFieldAiConfig } from './MultipleSelectFieldAiConfig';
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
]);

export const FieldAiConfig: React.FC<FieldAiConfigProps> = ({ field, onChange }) => {
  const { type: fieldType, isLookup, aiConfig } = field;
  const { type } = aiConfig ?? {};
  const baseId = useBaseId() as string;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const [isExpanded, setIsExpanded] = useState(!!aiConfig);

  const { data: baseAiConfig } = useQuery({
    queryKey: ['ai-config', baseId],
    queryFn: () => getAIConfig(baseId).then(({ data }) => data),
  });

  const { llmProviders = [], modelDefinationMap = {} } = baseAiConfig ?? {};
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
      default:
        throw new Error(`Unsupported field type: ${fieldType}`);
    }
  };

  if (!SUPPORTED_FIELD_TYPES.has(fieldType as FieldType) || isLookup) {
    return null;
  }

  return (
    <Fragment>
      <div className="w-full rounded-md border border-indigo-200/75 text-sm">
        <div
          className={cn(
            `group flex cursor-pointer select-none items-center justify-between px-3 py-2 
            transition-all duration-500 ease-in-out 
            bg-gradient-to-r from-blue-100/75 via-indigo-100/75 to-purple-100/75
            hover:from-blue-200/60 hover:via-indigo-200/60 hover:to-purple-200/60 
            dark:from-blue-900/75 dark:via-indigo-900/75 dark:to-purple-900/75
            dark:hover:from-blue-800/60 dark:hover:via-indigo-800/60 dark:hover:to-purple-800/60
            rounded-sm`,
            isExpanded && 'rounded-b-none'
          )}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-x-1">
            <MagicAI className="size-4" active />
            {t('table:field.aiConfig.title')}
          </div>
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </div>

        {isExpanded && (
          <div className="space-y-2 border-t p-3">
            {getAiConfigRenderer()}
            {type && (
              <Fragment>
                <div className="flex flex-col gap-y-2">
                  <span>{t('table:field.aiConfig.label.model')}</span>
                  <AIModelSelect
                    value={aiConfig?.modelKey || ''}
                    onValueChange={(newValue) => {
                      onConfigChange('modelKey', newValue);
                    }}
                    options={models}
                    className="w-full px-2"
                    modelDefinationMap={modelDefinationMap}
                    needGroup
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
      <hr className="border-slate-200" />
    </Fragment>
  );
};
