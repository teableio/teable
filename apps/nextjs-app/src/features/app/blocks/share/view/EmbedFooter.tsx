import { ArrowUpRight, TeableNew } from '@teable/icons';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { shareConfig } from '@/features/i18n/share.config';

export const EmbedFooter = ({
  hideBranding,
  hideNewPage,
}: {
  hideBranding?: boolean;
  hideNewPage?: boolean;
}) => {
  const router = useRouter();
  const { t } = useTranslation(shareConfig.i18nNamespaces);
  const fullPath = router.asPath;
  const url = new URL(fullPath, 'https://app.teable.io'); // Use a dummy base URL
  url.searchParams.delete('embed');
  const pathWithoutEmbed = `${url.pathname}${url.search}`;

  return (
    <div className="flex items-center justify-between border-t px-2 py-1 text-xs">
      {!hideBranding && (
        <Link href="/" className="flex items-center gap-1" target="_blank">
          <TeableNew className="size-4 text-black" />
          Teable
        </Link>
      )}
      {!hideNewPage && (
        <Link className="flex gap-1" href={pathWithoutEmbed} target="_blank">
          <ArrowUpRight className="size-4" />
          {t('share:openOnNewPage')}
        </Link>
      )}
    </div>
  );
};
