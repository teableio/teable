import { HttpException, HttpStatus } from '@nestjs/common';

const errors = {
  missing_email_unlinked: {
    message: 'No email provided from Apple',
    status: HttpStatus.UNAUTHORIZED,
    authError: 'apple_email_unavailable',
  },
  deactivated: {
    message: 'Your account has been deactivated by the administrator',
    status: HttpStatus.BAD_REQUEST,
    authError: 'apple_account_unavailable',
  },
  invalid_state: {
    message: 'Invalid authorization request state',
    status: HttpStatus.UNAUTHORIZED,
    authError: 'apple_session_expired',
  },
} as const;

export class AppleAuthException extends HttpException {
  readonly authError: string;

  constructor(readonly reason: keyof typeof errors) {
    const error = errors[reason];
    super(error.message, error.status);
    this.authError = error.authError;
  }
}
