import type { GetServerSideProps } from 'next';
import { systemConfig } from '@/features/i18n/system.config';
import { PaymentRequiredPage } from '@/features/system/pages';
import { getTranslationsProps } from '@/lib/i18n';

export const getServerSideProps: GetServerSideProps = async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, systemConfig.i18nNamespaces)),
    },
  };
};

export default function Custom402() {
  return <PaymentRequiredPage />;
}
