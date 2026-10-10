import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute } from '../utils';
import { z } from '../zod';
import type { IUserMeVo } from './user-me';
import { userMeVoSchema } from './user-me';

/**
 * Sign-in for the native mobile app (RFC 8252 + PKCE).
 *
 * 1. The app opens `/auth/mobile?code_challenge=…&state=…&redirect_uri=teable://…` in the
 *    system browser (ASWebAuthenticationSession / Custom Tabs) and signs in there with any
 *    method the deployment offers.
 * 2. The page calls `POST /auth/mobile/code`; the server binds a one-time code to the user and
 *    the challenge and answers with the app redirect URL (`teable://auth/callback?code&state`).
 * 3. The app posts `code` + `codeVerifier` to `POST /auth/mobile/exchange`; the response
 *    carries the regular session cookie, so REST, SSE and WebViews share one session.
 * 4. A WebView that cannot receive injected cookies (iOS App-Bound Domains) signs itself in by
 *    loading `GET /auth/mobile/web-session?code=…`, using a code from
 *    `POST /auth/mobile/web-session-code`.
 */

/** The page the app opens in the system browser (a Web page, not an API route). */
export const MOBILE_AUTH_PAGE = '/auth/mobile';

/**
 * Query parameter the app adds to {@link MOBILE_AUTH_PAGE}: the platform signing in (`ios`,
 * `android`). It travels wherever that page is the destination — an OAuth `redirect_uri`, the
 * login page's `?redirect=` — so every step of the sign-in can read it.
 */
export const MOBILE_AUTH_PLATFORM_PARAM = 'platform';

/**
 * Apps whose sign-in may only reach existing accounts. App Review treats creating an account
 * inside the iOS app as a path to purchases made outside it (guideline 3.1.1), so that app signs
 * people in but never signs them up.
 */
export const MOBILE_SIGNUP_BLOCKED_PLATFORMS: readonly string[] = ['ios'];

/** The login page's `authError` when an app sign-in reaches no existing account. */
export const APP_SIGNUP_UNAVAILABLE_AUTH_ERROR = 'app_signup_unavailable';

/**
 * Whether a sign-in headed for `destination` — a same-origin path such as an OAuth
 * `redirect_uri` or the login page's `redirect` — started in an app that must not create
 * accounts.
 */
export const isAppSignupBlocked = (destination: string | null | undefined): boolean => {
  if (!destination?.startsWith('/')) return false;
  try {
    const url = new URL(destination, 'http://localhost');
    const platform = url.searchParams.get(MOBILE_AUTH_PLATFORM_PARAM);
    return (
      url.pathname === MOBILE_AUTH_PAGE &&
      platform !== null &&
      MOBILE_SIGNUP_BLOCKED_PLATFORMS.includes(platform)
    );
  } catch {
    return false;
  }
};

/** {@link isAppSignupBlocked} for a login page's query string (`?redirect=…`). */
export const isAppSignupBlockedQuery = (query: string | null | undefined): boolean => {
  if (!query) return false;
  return isAppSignupBlocked(new URLSearchParams(query).get('redirect'));
};

/** base64url(SHA-256(verifier)): 32 bytes → 43 characters, no padding. */
export const MOBILE_AUTH_CODE_CHALLENGE_RE = /^[\w-]{43}$/;
/** RFC 7636 §4.1 unreserved characters, 43–128 characters. */
export const MOBILE_AUTH_CODE_VERIFIER_RE = /^[\w\-.~]{43,128}$/;

export const MOBILE_AUTH_CODE = '/auth/mobile/code';

export const createMobileAuthCodeRoSchema = z.object({
  codeChallenge: z.string().regex(MOBILE_AUTH_CODE_CHALLENGE_RE),
  state: z.string().min(1).max(256),
  /** The app callback, e.g. `teable://auth/callback`; its scheme must be allow-listed. */
  redirectUri: z.string().min(1).max(2048),
});

export type ICreateMobileAuthCodeRo = z.infer<typeof createMobileAuthCodeRoSchema>;

export const createMobileAuthCodeVoSchema = z.object({
  /** `redirectUri` with `code` and `state` appended; the browser navigates here. */
  redirectUrl: z.string(),
});

export type ICreateMobileAuthCodeVo = z.infer<typeof createMobileAuthCodeVoSchema>;

export const CreateMobileAuthCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: MOBILE_AUTH_CODE,
  description: 'Issue a one-time sign-in code for the mobile app (PKCE)',
  request: {
    body: {
      content: {
        'application/json': {
          schema: createMobileAuthCodeRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The app redirect URL carrying the code',
      content: {
        'application/json': {
          schema: createMobileAuthCodeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const createMobileAuthCode = async (ro: ICreateMobileAuthCodeRo) => {
  return axios.post<ICreateMobileAuthCodeVo>(MOBILE_AUTH_CODE, ro);
};

export const MOBILE_AUTH_EXCHANGE = '/auth/mobile/exchange';

export const exchangeMobileAuthCodeRoSchema = z.object({
  code: z.string().min(1).max(256),
  codeVerifier: z.string().regex(MOBILE_AUTH_CODE_VERIFIER_RE),
});

export type IExchangeMobileAuthCodeRo = z.infer<typeof exchangeMobileAuthCodeRoSchema>;

export const ExchangeMobileAuthCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: MOBILE_AUTH_EXCHANGE,
  description: 'Exchange a mobile sign-in code for a session; the response sets the session cookie',
  request: {
    body: {
      content: {
        'application/json': {
          schema: exchangeMobileAuthCodeRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Signed in',
      content: {
        'application/json': {
          schema: userMeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const exchangeMobileAuthCode = async (ro: IExchangeMobileAuthCodeRo) => {
  return axios.post<IUserMeVo>(MOBILE_AUTH_EXCHANGE, ro);
};

export const MOBILE_AUTH_WEB_SESSION_CODE = '/auth/mobile/web-session-code';

export const createMobileWebSessionCodeVoSchema = z.object({
  code: z.string(),
});

export type ICreateMobileWebSessionCodeVo = z.infer<typeof createMobileWebSessionCodeVoSchema>;

export const CreateMobileWebSessionCodeRoute: RouteConfig = registerRoute({
  method: 'post',
  path: MOBILE_AUTH_WEB_SESSION_CODE,
  description: 'Issue a one-time code that signs a WebView in through GET /auth/mobile/web-session',
  request: {},
  responses: {
    201: {
      description: 'The code',
      content: {
        'application/json': {
          schema: createMobileWebSessionCodeVoSchema,
        },
      },
    },
  },
  tags: ['auth'],
});

export const createMobileWebSessionCode = async () => {
  return axios.post<ICreateMobileWebSessionCodeVo>(MOBILE_AUTH_WEB_SESSION_CODE);
};

export const MOBILE_AUTH_WEB_SESSION = '/auth/mobile/web-session';

export const mobileWebSessionQuerySchema = z.object({
  code: z.string().min(1).max(256),
  /** Same-origin path to land on; defaults to `/space`. */
  redirect: z.string().max(2048).optional(),
});

export type IMobileWebSessionQuery = z.infer<typeof mobileWebSessionQuerySchema>;

export const MobileWebSessionRoute: RouteConfig = registerRoute({
  method: 'get',
  path: MOBILE_AUTH_WEB_SESSION,
  description:
    'Sign the browser in with a web-session code and redirect (a navigation, not an XHR)',
  request: {
    query: mobileWebSessionQuerySchema,
  },
  responses: {
    302: {
      description: 'Redirects to `redirect` (same-origin path) or /space',
    },
  },
  tags: ['auth'],
});

/** Absolute URL a WebView loads to adopt the native session. */
export const getMobileWebSessionUrl = (origin: string, code: string, redirect?: string) => {
  const url = new URL(`/api${MOBILE_AUTH_WEB_SESSION}`, origin);
  url.searchParams.set('code', code);
  if (redirect) url.searchParams.set('redirect', redirect);
  return url.toString();
};
