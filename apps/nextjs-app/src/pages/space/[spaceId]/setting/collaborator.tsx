import { QueryClient, dehydrate } from '@tanstack/react-query';
import { SpaceRole } from '@teable/core';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { CollaboratorPage } from '@/features/app/blocks/space-setting';
import { SpaceSettingLayout } from '@/features/app/layouts/SpaceSettingLayout';
import { spaceConfig } from '@/features/i18n/space.config';
import { getTranslationsProps } from '@/lib/i18n';
import { spaceRoleChecker } from '@/lib/space-role-checker';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Collaborator: NextPageWithLayout = () => <CollaboratorPage />;

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { spaceId } = context.query;
  const queryClient = new QueryClient();

  await queryClient.fetchQuery({
    queryKey: ['space', spaceId as string],
    queryFn: ({ queryKey }) => ssrApi.getSpaceById(queryKey[1]),
  });

  spaceRoleChecker({
    queryClient,
    spaceId: spaceId as string,
    roles: [SpaceRole.Owner],
  });

  return {
    props: {
      dehydratedState: dehydrate(queryClient),
      ...(await getTranslationsProps(context, spaceConfig.i18nNamespaces)),
    },
  };
});

Collaborator.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceSettingLayout {...pageProps}>{page}</SpaceSettingLayout>;
};

export default Collaborator;
