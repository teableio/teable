import { useMutation } from '@tanstack/react-query';
import { shareViewFormSubmit } from '@teable/openapi';
import { ShareViewContext } from '@teable/sdk/context';
import { useRouter } from 'next/router';
import { useContext } from 'react';
import { FormPreviewer } from '@/features/app/blocks/view/form/components';
import { FormViewBase } from './FormViewBase';

export const FormView = () => {
  const { shareId } = useContext(ShareViewContext);
  const { mutateAsync } = useMutation({
    mutationFn: shareViewFormSubmit,
  });

  const {
    query: { embed },
  } = useRouter();

  const onSubmit = async (fields: Record<string, unknown>) => {
    await mutateAsync({ shareId, fields });
  };
  return (
    <div className="flex size-full">
      {embed ? <FormViewBase /> : <FormPreviewer submit={onSubmit} />}
    </div>
  );
};
