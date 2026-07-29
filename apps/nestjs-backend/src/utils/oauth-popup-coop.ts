import type { NextFunction, Request, Response } from 'express';

/**
 * Navigation hops of OAuth popup flows (documents and redirect responses).
 *
 * helmet's default `Cross-Origin-Opener-Policy: same-origin` is applied to
 * every response, and COOP is enforced on each response of a navigation —
 * redirects included. A popup opened by a cross-origin page (e.g. a generated
 * app signing in with Teable) is severed from its opener on the FIRST hop
 * served here, which permanently breaks `window.close()` on the completion
 * page and any postMessage back to the opener.
 *
 * These endpoints render nothing beyond login/consent UI, so relaxing COOP on
 * them does not weaken the isolation of application documents. Precedent:
 * user-integration OAuth controllers set the same header inline.
 */
const OAUTH_POPUP_PATHS: RegExp[] = [
  // OAuth server: authorize entry (302 to login page / consent page / client
  // redirect_uri) and the consent form POST (302 to client redirect_uri).
  /^\/api\/oauth\/(authorize|decision)\/?$/,
  // Social sign-in entries and IdP callbacks (302 hops inside the popup).
  /^\/api\/auth\/(github|google|oidc)(\/callback)?\/?$/,
  // EE dynamic enterprise SSO providers (same shape, provider id from DB).
  /^\/api\/auth\/authentication\/[^/]+(\/callback)?\/?$/,
  // EE app-builder login broker callbacks (302 back to the generated app).
  /^\/api\/app-auth\/[^/]+\/callback\/?$/,
  // Pages shown inside the popup. NOTE: for page routes Next applies its own
  // configured headers after this middleware and overwrites COOP, so the
  // authoritative page-side fix lives in both next.config.js headers() blocks;
  // these entries only cover responses served before Next takes over.
  /^\/auth\/login\/?$/,
  /^\/oauth\/decision\/?$/,
];

export function relaxOAuthPopupCoop(req: Request, res: Response, next: NextFunction) {
  if (OAUTH_POPUP_PATHS.some((pattern) => pattern.test(req.path))) {
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  }
  next();
}
