import Head from 'next/head';
import { useTranslation } from 'next-i18next';
import { NotFoundPage } from '@/features/system/pages';
import type { ITemplateLinkPageProps } from './link-preview';

/**
 * What /t and /s render when they do not redirect: the meta tags a link preview reads, or
 * the page someone lands on when the template is no longer available.
 */
export const TemplateLinkPage = ({ preview, unavailable }: ITemplateLinkPageProps) => {
  const { t } = useTranslation('common');
  if (unavailable) {
    return <NotFoundPage title={t('template.unavailable')} description="" />;
  }
  if (!preview) return null;
  const { title, description, image, url, destination } = preview;
  return (
    <>
      <Head>
        <title>{title}</title>
        {description && <meta name="description" content={description} />}
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Teable" />
        <meta property="og:title" content={title} />
        {description && <meta property="og:description" content={description} />}
        {image && <meta property="og:image" content={image} />}
        <meta property="og:url" content={url} />
        <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={title} />
        {description && <meta name="twitter:description" content={description} />}
        {image && <meta name="twitter:image" content={image} />}
      </Head>
      <main>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        <a href={destination}>{title}</a>
      </main>
    </>
  );
};
