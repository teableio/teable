import { useIsMobile, useTableId, useViewId } from '@teable-group/sdk/hooks';
import { FormMode, useFormModeStore } from '../../tool-bar/store';
import { FormEditor, FormPreviewer } from './components';
import { generateUniqLocalKey } from './util';

export const FormView = () => {
  const tableId = useTableId();
  const activeViewId = useViewId();
  const { modeMap } = useFormModeStore();
  const isMobile = useIsMobile();

  const modeKey = generateUniqLocalKey(tableId, activeViewId);
  const mode = modeMap[modeKey] ?? FormMode.Edit;
  const isEditMode = mode === FormMode.Edit;

  return (
    <div className="flex h-full w-full">
      {isEditMode && !isMobile ? <FormEditor /> : <FormPreviewer />}
    </div>
  );
};
