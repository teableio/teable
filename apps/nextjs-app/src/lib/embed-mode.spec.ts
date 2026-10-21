import { describe, expect, it } from 'vitest';
import {
  EMBED_MODE_MOBILE,
  EMBED_MODE_STORAGE_KEY,
  detectEmbedMode,
  isEmbedModeRequest,
} from './embed-mode';

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) TeableMobile/1.2.0';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

describe('detectEmbedMode', () => {
  it('is false outside a browser', () => {
    expect(detectEmbedMode(undefined)).toBe(false);
  });

  it('is true for ?embed=mobile and persists it for the session in the app WebView', () => {
    const storage = memoryStorage();
    expect(
      detectEmbedMode({ search: '?embed=mobile&theme=dark', userAgent: MOBILE_UA, storage })
    ).toBe(true);
    expect(storage.data.get(EMBED_MODE_STORAGE_KEY)).toBe(EMBED_MODE_MOBILE);
  });

  it('honours ?embed=mobile on desktop for that page only, without persisting it', () => {
    const storage = memoryStorage();
    expect(
      detectEmbedMode({ search: '?embed=mobile&theme=dark', userAgent: DESKTOP_UA, storage })
    ).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('ignores other embed values (share view iframe embeds use embed=true)', () => {
    const storage = memoryStorage();
    expect(detectEmbedMode({ search: '?embed=true', userAgent: DESKTOP_UA, storage })).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  it('keeps embed mode from the persisted session flag when the query is gone', () => {
    const storage = memoryStorage({ [EMBED_MODE_STORAGE_KEY]: EMBED_MODE_MOBILE });
    expect(detectEmbedMode({ search: '', userAgent: DESKTOP_UA, storage })).toBe(true);
  });

  it('detects the mobile app user agent without query or storage', () => {
    expect(detectEmbedMode({ search: '', userAgent: MOBILE_UA, storage: null })).toBe(true);
  });

  it('survives a throwing storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(detectEmbedMode({ search: '?embed=mobile', userAgent: MOBILE_UA, storage })).toBe(true);
    expect(detectEmbedMode({ search: '', userAgent: DESKTOP_UA, storage })).toBe(false);
  });

  it('is false on desktop', () => {
    expect(
      detectEmbedMode({ search: '?theme=dark', userAgent: DESKTOP_UA, storage: memoryStorage() })
    ).toBe(false);
  });
});

describe('isEmbedModeRequest', () => {
  it('reads embed=mobile from the parsed query', () => {
    expect(isEmbedModeRequest({ query: { baseId: 'bse1', embed: 'mobile' } })).toBe(true);
    expect(isEmbedModeRequest({ query: { embed: ['mobile'] } })).toBe(true);
    expect(isEmbedModeRequest({ query: { embed: 'true' } })).toBe(false);
  });

  it('reads the mobile app user agent', () => {
    expect(isEmbedModeRequest({ query: {}, req: { headers: { 'user-agent': MOBILE_UA } } })).toBe(
      true
    );
    expect(isEmbedModeRequest({ query: {}, req: { headers: { 'user-agent': DESKTOP_UA } } })).toBe(
      false
    );
  });

  it('is false for a plain request', () => {
    expect(isEmbedModeRequest({ query: {}, req: { headers: {} } })).toBe(false);
    expect(isEmbedModeRequest({ query: {} })).toBe(false);
  });
});
