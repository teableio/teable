import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createAccessToken,
  updateAccessToken,
  type CreateAccessTokenVo,
  type UpdateAccessTokenRo,
  type UpdateAccessTokenVo,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useRouter } from 'next/router';
import type { IFormType } from './form/AccessTokenForm';
import { AccessTokenForm } from './form/AccessTokenForm';
import { AccessTokenFormEdit } from './form/AccessTokenFormEdit';

interface IAccessTokenFormProps {
  formType?: IFormType;
  accessTokenId: string;
  onSubmit?: (data: CreateAccessTokenVo | UpdateAccessTokenVo) => void;
  onRefresh?: (token: string) => void;
  onCancel?: () => void;
}

export const PersonAccessTokenForm = (props: IAccessTokenFormProps) => {
  const { formType: propFormType, accessTokenId, onSubmit, onCancel, onRefresh } = props;
  const queryClient = useQueryClient();
  const router = useRouter();
  const type = propFormType ?? (router.query.form as IFormType);

  const { mutate: createAccessTokenMutate, isPending: createAccessTokenLoading } = useMutation({
    mutationFn: createAccessToken,
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.personAccessTokenList() });
      onSubmit?.(data.data);
    },
  });

  const { mutate: updateAccessTokenMutate, isPending: updateAccessTokenLoading } = useMutation({
    mutationFn: (updateRo: UpdateAccessTokenRo) => updateAccessToken(accessTokenId, updateRo),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.personAccessTokenList() });
      await queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.personAccessToken(data.data.id),
      });
      onSubmit?.(data.data);
    },
  });

  if (type === 'new') {
    return (
      <AccessTokenForm
        type="new"
        onSubmit={createAccessTokenMutate}
        isLoading={createAccessTokenLoading}
        onCancel={onCancel}
      />
    );
  }
  if (type === 'edit') {
    return (
      <AccessTokenFormEdit
        accessTokenId={accessTokenId}
        type="edit"
        onSubmit={updateAccessTokenMutate}
        isLoading={updateAccessTokenLoading}
        onCancel={onCancel}
        onRefresh={onRefresh}
      />
    );
  }
  return <></>;
};
