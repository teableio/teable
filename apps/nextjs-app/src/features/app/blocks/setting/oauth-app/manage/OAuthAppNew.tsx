import { useMutation, useQueryClient } from '@tanstack/react-query';
import { oauthCreate, type OAuthCreateRo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useRef, useState } from 'react';
import { FormPageLayout } from '../../components/FormPageLayout';
import type { IOAuthAppFormRef } from './OAuthAppForm';
import { OAuthAppForm } from './OAuthAppForm';

interface IOAuthAppNewProps {
  onBack: () => void;
}

export const OAuthAppNew = (props: IOAuthAppNewProps) => {
  const { onBack } = props;
  const formRef = useRef<IOAuthAppFormRef>(null);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OAuthCreateRo>({
    name: '',
    homepage: '',
    redirectUris: [],
  });

  const { mutate, isPending: isLoading } = useMutation({
    mutationFn: oauthCreate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.oauthAppList() });
      onBack();
    },
  });
  return (
    <FormPageLayout
      onCancel={onBack}
      onSubmit={() => {
        formRef.current?.validate() && mutate(form);
      }}
      loading={isLoading}
    >
      <OAuthAppForm ref={formRef} value={form} onChange={setForm} />
    </FormPageLayout>
  );
};
