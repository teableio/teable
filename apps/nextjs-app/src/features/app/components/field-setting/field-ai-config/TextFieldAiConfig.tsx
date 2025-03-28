import type {
  ITextFieldAIConfig,
  ITextFieldCustomizeAIConfig,
  ITextFieldExtractInfoAIConfig,
  ITextFieldImproveTextAIConfig,
  ITextFieldSummarizeAIConfig,
  ITextFieldTranslateAIConfig,
} from '@teable/core';
import { FieldAIActionType } from '@teable/core';
import { ArrowUpDown, Edit, Export, Layers, Pencil } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Input, Textarea } from '@teable/ui-lib/shadcn';
import { Fragment, useMemo } from 'react';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import type { IFieldEditorRo } from '../type';
import { PromptEditorContainer } from './components';

interface ITextFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const TextFieldAiConfig = (props: ITextFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { aiConfig } = field;
  const { type } = aiConfig ?? {};

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Summarize,
        icon: <Layers className="size-4" />,
        name: '总结',
      },
      {
        id: FieldAIActionType.Translate,
        icon: <ArrowUpDown className="size-4" />,
        name: '翻译',
      },
      {
        id: FieldAIActionType.ExtractInfo,
        icon: <Export className="size-4" />,
        name: '提取信息',
      },
      {
        id: FieldAIActionType.ImproveText,
        icon: <Edit className="size-4" />,
        name: '文案改写',
      },
      {
        id: FieldAIActionType.Customize,
        icon: <Pencil className="size-4" />,
        name: '自定义生成',
      },
    ];
  }, []);

  const getPlaceholder = (type: FieldAIActionType) => {
    switch (type) {
      case FieldAIActionType.Translate:
        return '翻译简洁易懂，语气轻松';
      case FieldAIActionType.ImproveText:
        return '语气正式，友好，幽默...';
      case FieldAIActionType.ExtractInfo:
        return '提取邮箱，电话，姓名，地址...';
      case FieldAIActionType.Summarize:
        return '总结内容的关键点';
      case FieldAIActionType.Customize:
        return '请输入自定义的提示';
      default:
        return '';
    }
  };

  const onConfigChange = (
    key:
      | keyof ITextFieldExtractInfoAIConfig
      | keyof ITextFieldSummarizeAIConfig
      | keyof ITextFieldTranslateAIConfig
      | keyof ITextFieldImproveTextAIConfig
      | keyof ITextFieldCustomizeAIConfig,
    value: unknown
  ) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as ITextFieldAIConfig });
      case 'sourceFieldId':
        return onChange?.({
          aiConfig: { ...aiConfig, sourceFieldId: value as string } as ITextFieldAIConfig,
        });
      case 'targetLanguage':
        return onChange?.({
          aiConfig: { ...aiConfig, targetLanguage: value as string } as ITextFieldTranslateAIConfig,
        });
      case 'attachPrompt':
        return onChange?.({
          aiConfig: { ...aiConfig, attachPrompt: value as string } as ITextFieldImproveTextAIConfig,
        });
      case 'prompt':
        console.log('prompt', value);
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as ITextFieldCustomizeAIConfig,
        });
      default:
        throw new Error(`Unsupported key: ${key}`);
    }
  };

  return (
    <Fragment>
      <div className="flex flex-col gap-y-2">
        <label>AI 动作类型</label>
        <Selector
          className="w-full"
          placeholder={'选择 AI 动作'}
          selectedId={type}
          onChange={(id) => {
            onConfigChange('type', id);
          }}
          candidates={candidates}
        />
      </div>

      {type && type !== FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <label>来源字段</label>
          <SelectFieldByTableId
            selectedId={(aiConfig as ITextFieldSummarizeAIConfig)?.sourceFieldId}
            onChange={(field) => {
              onConfigChange('sourceFieldId', field.id);
            }}
          />
        </div>
      )}

      {type === FieldAIActionType.Translate && (
        <div className="flex flex-col gap-y-2">
          <label>目标语言</label>
          <Input
            type="text"
            placeholder="英文，中文，法语..."
            className="w-full"
            value={(aiConfig as ITextFieldTranslateAIConfig)?.targetLanguage || ''}
            onChange={(e) => {
              onConfigChange('targetLanguage', e.target.value);
            }}
          />
        </div>
      )}

      {type && type !== FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <label>附加要求</label>
          <Textarea
            placeholder={getPlaceholder(type)}
            className="w-full"
            value={(aiConfig as ITextFieldImproveTextAIConfig)?.attachPrompt || ''}
            onChange={(e) => {
              onConfigChange('attachPrompt', e.target.value);
            }}
          />
        </div>
      )}

      {type === FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <PromptEditorContainer
            value={(aiConfig as ITextFieldCustomizeAIConfig)?.prompt || ''}
            onChange={(value) => onConfigChange('prompt', value)}
            label="自定义提示"
          />
        </div>
      )}
    </Fragment>
  );
};
