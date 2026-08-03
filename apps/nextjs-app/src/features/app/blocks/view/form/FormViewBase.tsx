import { useMutation } from '@tanstack/react-query';
import { formSubmit } from '@teable/openapi';
import { useViewId, useTableId, useIsMobile, useTablePermission } from '@teable/sdk/hooks';
import { FormMode, useFormModeStore } from '../tool-bar/store';
import { FormEditor, FormPreviewer } from './components';
import { generateUniqLocalKey } from './util';

export const FormViewBase = () => {
  const tableId = useTableId();
  const activeViewId = useViewId();
  const { modeMap } = useFormModeStore();
  const isMobile = useIsMobile();
  const permission = useTablePermission();

  const { mutateAsync: createRecords } = useMutation({
    mutationFn: (fields: Record<string, unknown>) =>
      formSubmit(tableId!, {
        viewId: activeViewId!,
        fields,
      }),
  });

  const modeKey = generateUniqLocalKey(tableId, activeViewId);
  const mode = modeMap[modeKey] ?? FormMode.Edit;
  const isEditMode = permission['view|update'] && mode === FormMode.Edit;

  const submitForm = async (fields: Record<string, unknown>) => {
    if (!tableId || !activeViewId) return;
    await createRecords(fields);
  };

  return (
    <div className="flex size-full">
      {isEditMode && !isMobile ? <FormEditor /> : <FormPreviewer submit={submitForm} />}
    </div>
  );
};
