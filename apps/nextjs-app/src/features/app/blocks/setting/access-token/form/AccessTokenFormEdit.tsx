import { useQuery } from '@tanstack/react-query';
import { getAccessToken } from '@teable-group/openapi';
import { ReactQueryKeys } from '@teable-group/sdk/config';
import { Skeleton } from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import type { IAccessTokenForm } from './AccessTokenForm';
import { AccessTokenForm } from './AccessTokenForm';

export const AccessTokenFormEdit = (props: IAccessTokenForm<'edit'>) => {
  const router = useRouter();
  const accessTokenId = router.query.id as string;
  const { data: accessTokenData, isLoading } = useQuery({
    queryKey: ReactQueryKeys.personAccessToken(accessTokenId),
    queryFn: () => getAccessToken(accessTokenId),
  });
  if (isLoading) {
    return (
      <div className="max-w-5xl space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  return <AccessTokenForm {...props} id={accessTokenId} defaultData={accessTokenData?.data} />;
};
