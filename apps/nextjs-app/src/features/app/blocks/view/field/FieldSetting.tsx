import { FieldType, fieldVoSchema, type IButtonFieldOptions, type IFieldVo } from '@teable/core';
import { createWorkflow } from '@teable/openapi';
import type { IFieldInstance } from '@teable/sdk';
import { useBaseId, useField, useTableId } from '@teable/sdk';
import { isEmpty } from 'lodash';
import { useWorkFlowPanelStore } from '@/features/app/automation/workflow-panel/useWorkFlowPaneStore';
import {
  FieldSetting as FieldSettingInner,
  FieldOperator,
} from '@/features/app/components/field-setting';
import { useFieldSettingStore } from './useFieldSettingStore';

export const FieldSetting = () => {
  const { setting, closeSetting } = useFieldSettingStore();
  const field = useField(setting?.fieldId);
  const order = setting?.order;
  const baseId = useBaseId() as string;
  const tableId = useTableId() as string;

  const handleOpenWorkflowPanel = async (field?: IFieldVo | IFieldInstance) => {
    const { from = '', openModal } = useWorkFlowPanelStore.getState();
    if (from === 'buttonFieldOptions' && field && field.type === FieldType.Button) {
      const options = field.options as IButtonFieldOptions;
      const workflow = options.workflow ?? {};
      let workflowId = workflow.id ?? '';
      if (isEmpty(workflowId)) {
        const result = await createWorkflow(baseId, {
          name: field.name,
          trigger: {
            type: 'buttonClick', // WorkflowTriggerType.ButtonClick
            config: {
              tableId,
              watchFieldIds: [field.id],
            },
          },
        });
        const workflow = result.data as { id: string };
        workflowId = workflow.id;
      }
      openModal(baseId, workflowId);
    }
  };

  const onCancel = () => {
    closeSetting();
    handleOpenWorkflowPanel(field);
  };

  const onConfirm = (fieldVo?: IFieldVo) => {
    closeSetting();
    handleOpenWorkflowPanel(fieldVo);
  };

  const visible = Boolean(setting);
  if (!visible) {
    return <></>;
  }

  const fieldVo = fieldVoSchema.safeParse(field);
  if (!fieldVo.success) {
    console.log('errorField:', field);
    console.error(fieldVo.error);
  }

  return (
    <FieldSettingInner
      visible={visible}
      field={fieldVo.success ? fieldVo.data : undefined}
      order={order}
      operator={setting?.operator || FieldOperator.Add}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
};
