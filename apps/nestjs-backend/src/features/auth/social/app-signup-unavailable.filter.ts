import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch } from '@nestjs/common';
import type { Response } from 'express';
import { AppSignupUnavailableException } from '../app-signup-unavailable.exception';

/**
 * OAuth callbacks are top-level navigations in the app's sign-in browser: an app sign-in that
 * found no account goes back to the login page with a notice rather than a JSON error.
 */
@Catch(AppSignupUnavailableException)
export class AppSignupUnavailableFilter implements ExceptionFilter {
  catch(exception: AppSignupUnavailableException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(303, exception.loginUrl);
  }
}
