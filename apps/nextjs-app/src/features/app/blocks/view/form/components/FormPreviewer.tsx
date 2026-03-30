import { useRef } from 'react';
import { BrandFooter } from './BrandFooter';
import { FormBody } from './FromBody';

interface IFormPreviewerProps {
  submit?: (fields: Record<string, unknown>) => Promise<void>;
}

export const FormPreviewer = (props: IFormPreviewerProps) => {
  const { submit } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  const onSubmit = async (formData: Record<string, unknown>) => {
    await submit?.(formData);
    setTimeout(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 1000);
  };

  return (
    <div className="w-full overflow-y-auto bg-muted pb-8 sm:pt-8" ref={containerRef}>
      <FormBody
        className="relative mx-auto mb-12 flex w-full max-w-screen-sm flex-col items-center overflow-hidden bg-background sm:rounded-[16px] sm:border sm:pb-10 sm:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.1),0_5px_15px_-5px_rgba(0,0,0,0.05)]"
        submit={submit ? (formData) => onSubmit(formData) : undefined}
      />
      <BrandFooter />
    </div>
  );
};
