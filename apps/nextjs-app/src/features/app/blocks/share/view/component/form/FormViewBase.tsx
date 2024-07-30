import { FormBody } from '@/features/app/blocks/view/form/components/FromBody';
import { EmbedFooter } from '../../EmbedFooter';

export const FormViewBase = () => {
  return (
    <div className="flex grow flex-col border">
      <FormBody className="grow overflow-auto pb-8" />
      <EmbedFooter hideNewPage />
    </div>
  );
};
