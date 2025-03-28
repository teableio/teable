import type {
  ISingleSelectFieldClassifyAIConfig,
  ISingleSelectFieldCustomizeAIConfig,
  ISingleSelectFieldAIConfig,
  ITextFieldAIConfig,
} from '@teable/core';
import { FieldAIActionType } from '@teable/core';
import { ListChecks, Pencil } from '@teable/icons';
import { Selector } from '@teable/ui-lib/base';
import { Textarea } from '@teable/ui-lib/shadcn';
import { Fragment, useMemo } from 'react';
import { SelectFieldByTableId } from '../lookup-options/LookupOptions';
import type { IFieldEditorRo } from '../type';
import { PromptEditorContainer } from './components';

interface ISingleSelectFieldAiConfigProps {
  field: Partial<IFieldEditorRo>;
  onChange?: (partialField: Partial<IFieldEditorRo>) => void;
}

export const SingleSelectFieldAiConfig = (props: ISingleSelectFieldAiConfigProps) => {
  const { field, onChange } = props;
  const { aiConfig } = field;
  const { type } = aiConfig ?? {};

  const candidates = useMemo(() => {
    return [
      {
        id: FieldAIActionType.Classify,
        icon: <ListChecks className="size-4" />,
        name: '智能分类',
      },
      {
        id: FieldAIActionType.Customize,
        icon: <Pencil className="size-4" />,
        name: '自定义生成',
      },
    ];
  }, []);

  const onConfigChange = (
    key: keyof ISingleSelectFieldClassifyAIConfig | keyof ISingleSelectFieldCustomizeAIConfig,
    value: unknown
  ) => {
    switch (key) {
      case 'type':
        return onChange?.({ aiConfig: { type: value } as ITextFieldAIConfig });
      case 'sourceFieldId':
        return onChange?.({
          aiConfig: { ...aiConfig, sourceFieldId: value as string } as ISingleSelectFieldAIConfig,
        });
      case 'attachPrompt':
        return onChange?.({
          aiConfig: {
            ...aiConfig,
            attachPrompt: value as string,
          } as ISingleSelectFieldClassifyAIConfig,
        });
      case 'prompt':
        return onChange?.({
          aiConfig: { ...aiConfig, prompt: value as string } as ISingleSelectFieldCustomizeAIConfig,
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
        <Fragment>
          <div className="flex flex-col gap-y-2">
            <label>选择一个字段，为其匹配已创建的分类</label>
            <SelectFieldByTableId
              selectedId={(aiConfig as ISingleSelectFieldClassifyAIConfig)?.sourceFieldId}
              onChange={(field) => {
                onConfigChange('sourceFieldId', field.id);
              }}
            />
          </div>
          <div className="flex flex-col gap-y-2">
            <label>附加要求</label>
            <Textarea
              placeholder="将“正在进行中”的分类为“无风险”"
              className="w-full"
              value={(aiConfig as ISingleSelectFieldClassifyAIConfig)?.attachPrompt || ''}
              onChange={(e) => {
                onConfigChange('attachPrompt', e.target.value);
              }}
            />
          </div>
        </Fragment>
      )}

      {type === FieldAIActionType.Customize && (
        <div className="flex flex-col gap-y-2">
          <PromptEditorContainer
            value={(aiConfig as ISingleSelectFieldCustomizeAIConfig)?.prompt || ''}
            onChange={(value) => onConfigChange('prompt', value)}
            label="自定义提示"
          />
        </div>
      )}
    </Fragment>
  );
};
