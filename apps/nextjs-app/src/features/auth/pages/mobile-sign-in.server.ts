import { HttpError, isAnonymous } from '@teable/core';
import type { ICreateMobileAuthCodeRo } from '@teable/openapi';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import { getUserMe } from '@/backend/api/rest/get-user';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';

export interface IMobileSignInPageProps {
  /** Account the browser session belongs to; shown on the consent page. */
  email?: string;
  /** What the page posts to `POST /api/auth/mobile/code` once the user confirms. */
  request?: ICreateMobileAuthCodeRo;
  error?: 'invalid_request';
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * `/auth/mobile?code_challenge=…&state=…&redirect_uri=teable://…`: the page the mobile app
 * opens in the system browser. Signed-out visitors go through the regular login (which sends
 * them back here); signed-in ones see a consent page and the code is minted only when they
 * confirm — never on load, so a page any app can open in the user's browser cannot sign
 * that app in silently. Wrap with the flavour's `withEnv`.
 */
export async function getMobileSignInServerSideProps(
  context: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<IMobileSignInPageProps>> {
  const { req, query } = context;
  const translations = await getTranslationsProps(context, authConfig.i18nNamespaces);
  const request: ICreateMobileAuthCodeRo = {
    codeChallenge: first(query.code_challenge),
    state: first(query.state),
    redirectUri: first(query.redirect_uri),
  };
  if (!request.codeChallenge || !request.state || !request.redirectUri) {
    return { props: { ...translations, error: 'invalid_request' } };
  }

  const toLogin = {
    redirect: {
      destination: `/auth/login?redirect=${encodeURIComponent(req.url ?? '/auth/mobile')}`,
      permanent: false as const,
    },
  };
  try {
    const user = await getUserMe(req.headers.cookie);
    if (!user || isAnonymous(user.id)) {
      return toLogin;
    }
    return { props: { ...translations, email: user.email, request } };
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
      return toLogin;
    }
    throw error;
  }
}
