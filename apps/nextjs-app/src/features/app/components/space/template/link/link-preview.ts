import type { ILinkPreview } from '@teable/openapi';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

/**
 * The crawlers that fetch a link to draw its preview card in a post or a chat. They read the
 * page's meta tags instead of following the redirect people get. Search engines are left out:
 * they follow the redirect to the template itself.
 */
const LINK_PREVIEW_BOT =
  /twitterbot|linkedinbot|facebookexternalhit|facebot|meta-externalagent|slackbot|slack-imgproxy|discordbot|telegrambot|whatsapp|applebot|pinterestbot|redditbot|skypeuripreview|microsoftpreview|embedly|iframely|vkshare|cardyb|mastodon|bitlybot/i;

export const isLinkPreviewBot = (userAgent: string | undefined): boolean =>
  Boolean(userAgent && LINK_PREVIEW_BOT.test(userAgent));

/** The link page's props: a preview card for a crawler, the template for everyone else. */
export interface ITemplateLinkPageProps {
  preview?: ILinkPreview & { url: string; destination: string };
  unavailable?: boolean;
}

const originOf = (context: GetServerSidePropsContext): string => {
  const configured = process.env.PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/+$/, '');
  const proto = (context.req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  return `${proto.split(',')[0]}://${context.req.headers.host}`;
};

const absolute = (url: string, origin: string): string => {
  try {
    return new URL(url, `${origin}/`).toString();
  } catch {
    return url;
  }
};

/** Where a template link goes: a redirect for people, a page of meta tags for link previews. */
export const templateLinkResult = (
  context: GetServerSidePropsContext,
  destination: string,
  preview: ILinkPreview | undefined
): GetServerSidePropsResult<ITemplateLinkPageProps> => {
  // A template link answers crawlers and people differently: shared caches must keep them apart
  if (preview) context.res.setHeader('Vary', 'User-Agent');
  if (!preview || !isLinkPreviewBot(context.req.headers['user-agent'])) {
    // 302: the landing changes when a new version is published
    return { redirect: { destination, permanent: false } };
  }
  const origin = originOf(context);
  return {
    props: {
      preview: {
        title: preview.title,
        description: preview.description,
        ...(preview.image ? { image: absolute(preview.image, origin) } : {}),
        url: absolute(context.resolvedUrl, origin),
        destination: absolute(destination, origin),
      },
    },
  };
};

/** The backend's answer for a template that exists but cannot be opened by its link. */
export const isTemplateUnavailable = (error: unknown): boolean =>
  (error as { data?: { templateUnavailable?: unknown } } | null)?.data?.templateUnavailable ===
  true;
