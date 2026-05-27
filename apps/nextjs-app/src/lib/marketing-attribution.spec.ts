import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMarketingAttribution, syncMarketingAttributionFromUrl } from './marketing-attribution';

const storageKey = 'teable_marketing_attribution';
const attributionTtlMs = 90 * 24 * 60 * 60 * 1000;
const originalTime = '2026-05-01T00:00:00Z';
const laterTime = '2026-05-20T00:00:00Z';

const setLocationSearch = (search: string) => {
  window.history.replaceState(null, '', `/${search}`);
};

describe('marketing-attribution', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = '_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(originalTime));
    setLocationSearch('');
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('keeps the original 90-day window when no new attribution appears', () => {
    setLocationSearch('?utm_source=google&cta_id=hero');
    syncMarketingAttributionFromUrl();

    const firstStored = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    expect(firstStored.createdAt).toBe(Date.parse(originalTime));

    vi.setSystemTime(new Date(laterTime));
    setLocationSearch('');
    expect(getMarketingAttribution()).toEqual({
      utm_source: 'google',
      cta_id: 'hero',
    });

    const secondStored = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    expect(secondStored.createdAt).toBe(firstStored.createdAt);
  });

  it('expires stale attribution even after later visits without attribution params', () => {
    setLocationSearch('?utm_source=google');
    syncMarketingAttributionFromUrl();

    vi.setSystemTime(Date.now() + attributionTtlMs + 1);
    setLocationSearch('');

    expect(getMarketingAttribution()).toEqual({});
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('starts a new 90-day window when a new attribution touch is captured', () => {
    setLocationSearch('?utm_source=google');
    syncMarketingAttributionFromUrl();

    vi.setSystemTime(new Date(laterTime));
    setLocationSearch('?utm_source=bing');
    syncMarketingAttributionFromUrl();

    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    expect(stored.createdAt).toBe(Date.parse(laterTime));
    expect(stored.value).toEqual({ utm_source: 'bing' });
  });

  it('truncates collected attribution values before persisting them', () => {
    setLocationSearch(`?utm_content=${'a'.repeat(600)}`);

    expect(getMarketingAttribution()).toEqual({
      utm_content: 'a'.repeat(500),
    });
  });
});
