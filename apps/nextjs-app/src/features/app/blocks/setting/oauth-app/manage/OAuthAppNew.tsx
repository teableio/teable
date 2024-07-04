import { useMutation } from '@tanstack/react-query';
import { oauthCreate, type OAuthCreateRo } from '@teable/openapi';
import { useRef, useState } from 'react';
import { OAuthAppDetailLayout } from './OAuthAppDetailLayout';
import type { IOAuthAppFormRef } from './OAuthAppForm';
import { OAuthAppForm } from './OAuthAppForm';

interface IOAuthAppNewProps {
  onBack: () => void;
}

export const OAuthAppNew = (props: IOAuthAppNewProps) => {
  const { onBack } = props;
  const formRef = useRef<IOAuthAppFormRef>(null);
  const [form, setForm] = useState<OAuthCreateRo>({
    name: '',
    homepage: '',
    redirectUris: [],
  });

  const { mutate, isLoading } = useMutation({
    mutationFn: oauthCreate,
    onSuccess: () => {
      onBack();
    },
  });
  return (
    <OAuthAppDetailLayout
      onCancel={onBack}
      onSubmit={() => {
        formRef.current?.validate() && mutate(form);
      }}
      loading={isLoading}
    >
      <OAuthAppForm ref={formRef} value={form} onChange={setForm} />
    </OAuthAppDetailLayout>
  );
};
