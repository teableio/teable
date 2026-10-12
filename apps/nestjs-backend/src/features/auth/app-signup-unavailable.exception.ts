import { HttpErrorCode } from '@teable/core';
import { APP_SIGNUP_UNAVAILABLE_AUTH_ERROR } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { isValidRedirectPath } from './utils';

/**
 * A sign-in started in the iOS app reached no existing account. App Review counts creating an
 * account inside the app as a way to purchases made outside it (guideline 3.1.1), so none is
 * created. Browser sign-ins (OAuth, SSO) land on {@link loginUrl} instead of the raw error.
 */
export class AppSignupUnavailableException extends CustomHttpException {
  constructor(
    /** Where the sign-in was headed: the app's consent page, kept so the login page returns there. */
    readonly redirect?: string
  ) {
    super('No account is linked to this sign-in', HttpErrorCode.RESTRICTED_RESOURCE, {
      localization: { i18nKey: 'httpErrors.user.signupUnavailableInApp' },
    });
  }

  /** The login page with the notice, still on its way back to the app. */
  get loginUrl(): string {
    const query = new URLSearchParams({ authError: APP_SIGNUP_UNAVAILABLE_AUTH_ERROR });
    if (this.redirect && isValidRedirectPath(this.redirect)) {
      query.set('redirect', this.redirect);
    }
    return `/auth/login?${query.toString()}`;
  }
}
