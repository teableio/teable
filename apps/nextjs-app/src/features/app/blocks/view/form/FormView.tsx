import { useIsTemplate } from '@teable/sdk/hooks';
import { FormToolBar } from '../tool-bar/FormToolBar';
import { FormViewBase } from './FormViewBase';

export const FormView = () => {
  const isTemplate = useIsTemplate();
  return (
    <>
      {!isTemplate && <FormToolBar />}
      <div className="w-full grow overflow-hidden">
        <FormViewBase />
      </div>
    </>
  );
};
