import {
  BUTTON_FIELD_TEMP_WORKFLOW_ID,
  FieldType,
  fieldVoSchema,
  type IButtonFieldOptions,
  type IFieldVo,
} from '@teable/core';
import { buttonClickWorkflowCreate } from '@teable/openapi';
import { useBaseId, useField, useTableId } from '@teable/sdk';
import { useWorkFlowPanelStore } from '@/features/app/automation/workflow-panel/useWorkFlowPaneStore';
import {
  FieldSetting as FieldSettingInner,
  FieldOperator,
} from '@/features/app/components/field-setting';
import { useFieldSettingStore } from './useFieldSettingStore';

export const FieldSetting = () => {
  const { setting, closeSetting } = useFieldSettingStore();
  const workFlowPanelStore = useWorkFlowPanelStore();
  const field = useField(setting?.fieldId);
  const order = setting?.order;
  const baseId = useBaseId() as string;
  const tableId = useTableId() as string;
  const onCancel = () => {
    closeSetting();
  };

  const onConfirm = async (fieldVo?: IFieldVo) => {
    closeSetting();

    if (fieldVo && fieldVo.type === FieldType.Button) {
      const options = fieldVo.options as IButtonFieldOptions;
      let workflowId = '';
      if (options.workflowId === BUTTON_FIELD_TEMP_WORKFLOW_ID) {
        const result = await buttonClickWorkflowCreate(baseId, {
          tableId,
          watchFieldIds: [fieldVo.id],
        });
        const workflow = (result.data as { workflow: { id: string } }).workflow;
        workflowId = workflow.id;
      } else {
        workflowId = options.workflowId ?? '';
      }
      const { openModal } = workFlowPanelStore;
      openModal(baseId, workflowId);
    }
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
