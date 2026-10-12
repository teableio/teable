import { isSessionRevokedSignal, sessionRevokedSignal } from './session-revoked';

describe('session revoked signal', () => {
  it('recognises its own signal', () => {
    expect(isSessionRevokedSignal(sessionRevokedSignal())).toBe(true);
  });

  it('leaves notifications and anything else alone', () => {
    expect(isSessionRevokedSignal({ notification: { id: 'not1' }, unreadCount: 1 })).toBe(false);
    expect(isSessionRevokedSignal({ type: 'other' })).toBe(false);
    expect(isSessionRevokedSignal(null)).toBe(false);
    expect(isSessionRevokedSignal('session-revoked')).toBe(false);
  });
});
