import { useRef } from 'react';
import { FormBody } from '@/features/app/blocks/view/form/components/FromBody';
import { EmbedFooter } from '../../EmbedFooter';

interface IFormViewBaseProps {
  submit?: (fields: Record<string, unknown>) => Promise<void>;
}

export const FormViewBase = (props: IFormViewBaseProps) => {
  const { submit } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  const onSubmit = async (formData: Record<string, unknown>) => {
    await submit?.(formData);
    setTimeout(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 1000);
  };

  return (
    <div className="flex grow flex-col border" ref={containerRef}>
      <FormBody className="grow overflow-auto pb-8" submit={onSubmit} />
      <EmbedFooter hideNewPage />
    </div>
  );
};
