import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import type { ReactElement } from 'react';
import { adminConfig } from '@/features/admin/admin.config';
import { AdminLayout } from '@/features/admin/layouts';
import { AdminMainPage } from '@/features/admin/pages';
import i18nConfig from '../../../next-i18next.config';

type Props = {
  /** Add props here */
};

AdminRoute.getLayout = function getLayout(page: ReactElement) {
  return <AdminLayout>{page}</AdminLayout>;
};

export const getServerSideProps: GetServerSideProps<Props> = async (
  context
) => {
  const locale = context.res.getHeader('X-Server-Locale') as string | undefined;
  if (locale === undefined) {
    throw new HttpBadRequest('locale is missing');
  }
  const { i18nNamespaces } = adminConfig;
  return {
    props: {
      ...(await serverSideTranslations(locale, i18nNamespaces, i18nConfig)),
    },
  };
};

export default function AdminRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return <AdminMainPage />;
}
