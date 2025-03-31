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
    <div className="w-full overflow-y-auto pb-8 sm:pt-8" ref={containerRef}>
      <FormBody
        className="sm:shadow-mdw-full relative mx-auto mb-12 flex max-w-screen-sm flex-col items-center overflow-hidden sm:rounded-lg sm:border sm:pb-12"
        submit={(formData) => onSubmit(formData)}
      />
      <BrandFooter />
    </div>
  );
};
