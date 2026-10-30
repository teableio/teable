import { describe, expect, it } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import { MobileAuthCodeValidationPipe } from './mobile-auth-code.pipe';

const body = { codeChallenge: 'abc', state: 's1', redirectUri: 'teable://callback' };

describe('MobileAuthCodeValidationPipe', () => {
  const pipe = new MobileAuthCodeValidationPipe();

  it.each([
    ['a malformed code_challenge', body],
    ['an empty state', { ...body, codeChallenge: 'a'.repeat(43), state: '' }],
  ])('rejects %s with the mobileExchangeInvalid copy', (_, value) => {
    let error: unknown;
    try {
      pipe.transform(value, { type: 'body' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CustomHttpException);
    expect((error as CustomHttpException).data?.localization?.i18nKey).toBe(
      'httpErrors.auth.mobileExchangeInvalid'
    );
  });

  it('passes a valid body through', () => {
    const valid = { ...body, codeChallenge: 'a'.repeat(43) };
    expect(pipe.transform(valid, { type: 'body' })).toEqual(valid);
  });
});
