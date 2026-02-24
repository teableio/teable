import { useIsReadOnlyPreview } from '@teable/sdk/hooks';
import { FormToolBar } from '../tool-bar/FormToolBar';
import { FormViewBase } from './FormViewBase';

export const FormView = () => {
  const isReadOnlyPreview = useIsReadOnlyPreview();
  return (
    <>
      {!isReadOnlyPreview && <FormToolBar />}
      <div className="w-full grow overflow-hidden">
        <FormViewBase />
      </div>
    </>
  );
};
