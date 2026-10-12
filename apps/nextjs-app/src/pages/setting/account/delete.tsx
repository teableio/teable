import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { DeleteAccountPage } from '@/features/app/components/setting/account/DeleteAccountPage';
import { PlainLayout } from '@/features/app/layouts/PlainLayout';
import { settingAccountConfig } from '@/features/i18n/setting-account.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

/**
 * Deleting an account, on a page of its own. The phone app's settings send the reader here
 * rather than running the flow a second time in native code: it is the same few screens of
 * conditional state either way, and one of them is worth having once.
 *
 * On its own means without the settings around it: no sidebar of sibling tabs, on any width.
 * It is one task, not a place to be.
 */
const DeleteAccountSetting: NextPageWithLayout = () => {
  return <DeleteAccountPage />;
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(async (context) => {
    return {
      props: {
        ...(await getTranslationsProps(context, settingAccountConfig.i18nNamespaces)),
      },
    };
  })
);

DeleteAccountSetting.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <PlainLayout {...pageProps}>{page}</PlainLayout>;
};

export default DeleteAccountSetting;
