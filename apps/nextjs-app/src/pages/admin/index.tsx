import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetStaticProps, InferGetStaticPropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import type { ReactElement } from 'react';
import { adminConfig } from '@/features/admin/admin.config';
import { AdminLayout } from '@/features/admin/layouts';
import { AdminMainPage } from '@/features/admin/pages';

type Props = {
  /** Add props here */
};

AdminRoute.getLayout = function getLayout(page: ReactElement) {
  return <AdminLayout>{page}</AdminLayout>;
};

export const getStaticProps: GetStaticProps<Props> = async (context) => {
  const { locale } = context;
  if (locale === undefined) {
    throw new HttpBadRequest('locale is missing');
  }
  const { i18nNamespaces } = adminConfig;
  return {
    props: {
      ...(await serverSideTranslations(locale, i18nNamespaces)),
    },
    // revalidate: 60,
  };
};

export default function AdminRoute(
  _props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <AdminMainPage />;
}
