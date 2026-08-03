import type { DehydratedState } from '@tanstack/react-query';
import type { IGetSpaceVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { find } from 'lodash';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';

export const SpacePageTitle = (props: { dehydratedState?: DehydratedState }) => {
  const { dehydratedState } = props;
  const { t } = useTranslation('space');
  const router = useRouter();
  const spaceId = router.query.spaceId as string;

  const findSpaceName = () => {
    const spaceData = find(dehydratedState?.queries || [], {
      queryHash: JSON.stringify(ReactQueryKeys.space(spaceId)),
    })?.state.data as IGetSpaceVo;
    return spaceData?.name;
  };
  return (
    <Head>
      <title>{spaceId && dehydratedState ? findSpaceName() : t('allSpaces')}</title>
    </Head>
  );
};
