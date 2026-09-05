import type { IHttpError } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import type { GetServerSideProps } from 'next';
import { Error } from '@/features/app/blocks/Error';
import ensureLogin from '@/lib/ensureLogin';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const InvitePage: NextPageWithLayout<{ errorCode?: string | null }> = ({ errorCode }) => {
  // Joining through this link needs a purchased seat and the space has none
  // left; only the space owner can fix that, so point the joiner at them.
  const message =
    errorCode === HttpErrorCode.USER_LIMIT_EXCEEDED
      ? 'This space has no seats left for new members. Ask the space owner to add seats, then open the invite link again.'
      : 'Sorry, we were unable to accept the invite.';
  return <Error message={message} />;
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
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
            props: { errorCode: error.code ?? null },
          };
        }
        throw error;
      }
    })
  )
);

export default InvitePage;
