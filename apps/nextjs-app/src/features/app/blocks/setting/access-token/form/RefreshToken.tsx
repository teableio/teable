import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RefreshAccessTokenRo } from '@teable/openapi';
import { refreshAccessToken } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Spin } from '@teable/ui-lib/base';
import {
  Dialog,
  DialogTrigger,
  Button,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { RequireCom } from '../../components/RequireCom';
import { ExpirationSelect } from './ExpirationSelect';

interface IRefreshTokenProps {
  accessTokenId: string;
  onRefresh?: (token: string) => void;
}

export const RefreshToken = (props: IRefreshTokenProps) => {
  const { accessTokenId, onRefresh } = props;
  const { t } = useTranslation(personalAccessTokenConfig.i18nNamespaces);
  const [expiredTime, setExpiredTime] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const { mutate: refreshTokenMute, isLoading } = useMutation({
    mutationFn: (body?: RefreshAccessTokenRo) => refreshAccessToken(accessTokenId, body),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.personAccessTokenList() });
      await queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.personAccessToken(accessTokenId),
      });
      onRefresh?.(data.data.token);
    },
  });

  const refreshToken = () => {
    expiredTime && refreshTokenMute({ expiredTime });
  };
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={'xs'} variant="destructive">
          {t('token:refresh.button')}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-96 text-sm">
        <DialogHeader>
          <DialogTitle>{t('token:refresh.title')}</DialogTitle>
          <DialogDescription>{t('token:refresh.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>
            {t('token:expiration')} <RequireCom />
          </Label>
          <ExpirationSelect onChange={setExpiredTime} />
        </div>
        <DialogFooter>
          <Button
            size={'sm'}
            type="submit"
            onClick={refreshToken}
            disabled={!expiredTime || isLoading}
          >
            {isLoading && <Spin />}
            {t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
