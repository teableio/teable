import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import type { FC } from 'react';
import { adminConfig } from '@/features/admin/admin.config';

export const AdminMainPage: FC = () => {
  const { t } = useTranslation(adminConfig.i18nNamespaces);
  return (
    <>
      <NextSeo title={t('admin:page.title')} nofollow={true} noindex={true} />
      <h1>This page is protected by Middleware</h1>
      <p>Only admin users can see this page.</p>
      <p>
        To learn more about the NextAuth middleware see&nbsp;
        <a href="https://docs-git-misc-docs-nextauthjs.vercel.app/configuration/nextjs#middleware">
          the docs
        </a>
        .
      </p>
    </>
  );
};
