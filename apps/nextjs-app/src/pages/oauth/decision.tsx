import type { IUser } from '@teable/sdk/context';
import { AppProvider, SessionProvider } from '@teable/sdk/context';
import type { GetServerSideProps } from 'next';
import { useTranslation } from 'next-i18next';
import type { ReactElement } from 'react';
import { OAuthAppDecisionPage } from '@/features/app/blocks/setting/oauth-app/OAuthAppDecisionPage';
import { useSdkLocale } from '@/features/app/hooks/useSdkLocale';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

const OAuthAppDecision: NextPageWithLayout = () => {
  return <OAuthAppDecisionPage />;
};

const OAuthAppDecisionLayout = ({
  children,
  user,
}: {
  children: React.ReactNode;
  user?: IUser;
}) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();

  return (
    <AppProvider lang={i18n.language} locale={sdkLocale}>
      <SessionProvider user={user}>{children}</SessionProvider>
    </AppProvider>
  );
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(async (context) => {
    return {
      props: {
        ...(await getTranslationsProps(context, oauthAppConfig.i18nNamespaces)),
      },
    };
  })
);

OAuthAppDecision.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <OAuthAppDecisionLayout {...pageProps}>{page}</OAuthAppDecisionLayout>;
};

export default OAuthAppDecision;
