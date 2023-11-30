import { FormToolBar } from '../tool-bar/FormToolBar';
import { FormViewBase } from './FormViewBase';

export const FormView = () => {
  return (
    <>
      <FormToolBar />
      <div className="w-full grow overflow-hidden">
        <FormViewBase />
      </div>
    </>
  );
};
