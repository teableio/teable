import { MASKED_SECRET_PREFIX } from '@teable/openapi';
import { isMaskStillValid, isStaleMaskedSecret, reconcileMaskedSecret } from './masked-secret';

const SAVED_URL = 'https://gateway.example.com/v1';
const OTHER_URL = 'https://attacker.example.com/v1';
const MASK = `${MASKED_SECRET_PREFIX}abc`;

describe('isMaskStillValid', () => {
  it('keeps a mask valid while the endpoint is unchanged', () => {
    for (const mode of ['strict', 'orDefault'] as const) {
      expect(isMaskStillValid({ savedEndpoint: SAVED_URL, nextEndpoint: SAVED_URL, mode })).toBe(
        true
      );
    }
    // A missing and an empty endpoint are the same endpoint.
    expect(isMaskStillValid({ savedEndpoint: null, nextEndpoint: '', mode: 'strict' })).toBe(true);
  });

  it('invalidates a mask when the endpoint moves to another address', () => {
    for (const mode of ['strict', 'orDefault'] as const) {
      expect(isMaskStillValid({ savedEndpoint: SAVED_URL, nextEndpoint: OTHER_URL, mode })).toBe(
        false
      );
      expect(isMaskStillValid({ savedEndpoint: '', nextEndpoint: OTHER_URL, mode })).toBe(false);
    }
  });

  it('keeps an orDefault mask valid when the endpoint is cleared, but not a strict one', () => {
    expect(
      isMaskStillValid({ savedEndpoint: SAVED_URL, nextEndpoint: '', mode: 'orDefault' })
    ).toBe(true);
    expect(isMaskStillValid({ savedEndpoint: SAVED_URL, nextEndpoint: '', mode: 'strict' })).toBe(
      false
    );
  });

  it('compares non-string endpoints such as a port by value', () => {
    expect(isMaskStillValid({ savedEndpoint: 465, nextEndpoint: 465, mode: 'strict' })).toBe(true);
    expect(isMaskStillValid({ savedEndpoint: 465, nextEndpoint: 587, mode: 'strict' })).toBe(false);
  });
});

describe('isStaleMaskedSecret', () => {
  const moved = { savedEndpoint: SAVED_URL, nextEndpoint: OTHER_URL, mode: 'strict' } as const;
  const kept = { savedEndpoint: SAVED_URL, nextEndpoint: SAVED_URL, mode: 'strict' } as const;

  it('flags a mask once any of its endpoints moved', () => {
    expect(isStaleMaskedSecret(MASK, [kept, moved])).toBe(true);
    expect(isStaleMaskedSecret(MASK, [kept])).toBe(false);
  });

  it('never flags a secret the user typed, or an empty one', () => {
    expect(isStaleMaskedSecret('sk-typed', [moved])).toBe(false);
    expect(isStaleMaskedSecret('', [moved])).toBe(false);
    expect(isStaleMaskedSecret(undefined, [moved])).toBe(false);
  });
});

describe('reconcileMaskedSecret', () => {
  const at = (nextEndpoint: string) => [
    { savedEndpoint: SAVED_URL, nextEndpoint, mode: 'strict' as const },
  ];

  it('empties a mask once its endpoint moves, and brings it back when the endpoint returns', () => {
    const moved = reconcileMaskedSecret({
      secret: MASK,
      savedSecret: MASK,
      cleared: false,
      endpoints: at(OTHER_URL),
    });
    expect(moved).toEqual({ value: '', cleared: true });

    expect(
      reconcileMaskedSecret({
        secret: '',
        savedSecret: MASK,
        cleared: true,
        endpoints: at(SAVED_URL),
      })
    ).toEqual({ value: MASK, cleared: false });
  });

  it('leaves typed input and a field the user emptied alone', () => {
    expect(
      reconcileMaskedSecret({
        secret: 'sk-typed',
        savedSecret: MASK,
        cleared: true,
        endpoints: at(SAVED_URL),
      })
    ).toBeUndefined();
    expect(
      reconcileMaskedSecret({
        secret: '',
        savedSecret: MASK,
        cleared: false,
        endpoints: at(SAVED_URL),
      })
    ).toBeUndefined();
    expect(
      reconcileMaskedSecret({
        secret: '',
        savedSecret: MASK,
        cleared: true,
        endpoints: at(OTHER_URL),
      })
    ).toBeUndefined();
  });
});
