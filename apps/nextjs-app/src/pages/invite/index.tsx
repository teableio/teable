import type { IHttpError } from '@teable/core';
import type { GetServerSideProps } from 'next';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import { Error } from '@/features/app/blocks/Error';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const InvitePage: NextPageWithLayout<{ error?: IHttpError }> = () => {
  return <Error message="Sorry, we were unable to accept the invite." />;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context) => {
  const { invitationId, invitationCode } = context.query;
  try {
    const { spaceId, baseId } = await ssrApi.acceptInvitationLink({
      invitationId: invitationId as string,
      invitationCode: invitationCode as string,
    });
    if (spaceId) {
      return {
        redirect: {
          destination: `/space/${spaceId}`,
          permanent: false,
        },
      };
    }
    if (baseId) {
      return {
        redirect: {
          destination: `/base/${baseId}`,
          permanent: false,
        },
      };
    }

    return { props: {} };
  } catch (e) {
    const error = e as IHttpError;
    console.log('error === ', error);
    if (error.status !== 401) {
      return {
        props: {},
      };
    }
    throw error;
  }
});

export default InvitePage;
