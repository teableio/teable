import { useTableId, useViewId } from '@teable-group/sdk/hooks';
import { useMedia } from 'react-use';
import { FormMode, useFormModeStore } from '../../tool-bar/store';
import { FormEditor, FormPreviewer } from './components';
import { generateUniqLocalKey } from './util';

export const FormView = () => {
  const tableId = useTableId();
  const activeViewId = useViewId();
  const { modeMap } = useFormModeStore();
  const isWide = useMedia('(min-width: 640px)');

  const modeKey = generateUniqLocalKey(tableId, activeViewId);
  const mode = modeMap[modeKey] ?? FormMode.Edit;
  const isEditMode = mode === FormMode.Edit;

  return (
    <div className="flex h-full w-full">
      {isEditMode && isWide ? <FormEditor /> : <FormPreviewer />}
    </div>
  );
};
