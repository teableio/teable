/**
 * Pushed on a user's notification channel when their sessions have just been revoked
 * (the account was deactivated). Every page they still have open is expected to leave
 * for the sign-in page on receipt, rather than sit there until its next request is refused.
 */
export const SESSION_REVOKED_SIGNAL = 'session-revoked';

export interface ISessionRevokedSignal {
  type: typeof SESSION_REVOKED_SIGNAL;
}

export const sessionRevokedSignal = (): ISessionRevokedSignal => ({
  type: SESSION_REVOKED_SIGNAL,
});

export const isSessionRevokedSignal = (data: unknown): data is ISessionRevokedSignal =>
  typeof data === 'object' &&
  data != null &&
  (data as { type?: unknown }).type === SESSION_REVOKED_SIGNAL;
