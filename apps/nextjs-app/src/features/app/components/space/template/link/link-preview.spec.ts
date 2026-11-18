import type { GetServerSidePropsContext } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLinkPreviewBot, isTemplateUnavailable, templateLinkResult } from './link-preview';

const context = (userAgent: string, resolvedUrl = '/s/k3Pq9xYb2') =>
  ({
    req: { headers: { 'user-agent': userAgent, host: 'internal:3000' } },
    res: { setHeader: vi.fn() },
    resolvedUrl,
  }) as unknown as GetServerSidePropsContext;

const preview = {
  title: 'Lotus Yoga',
  description: 'Class booking for yoga studios.',
  image: '/api/attachments/read/public/template/cover.png',
};

describe('isLinkPreviewBot', () => {
  it.each([
    'Twitterbot/1.0',
    'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
    'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'TelegramBot (like TwitterBot)',
    'WhatsApp/2.23.20.0 A',
  ])('treats %s as a link preview crawler', (ua) => {
    expect(isLinkPreviewBot(ua)).toBe(true);
  });

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    '',
    undefined,
  ])('sends %s to the template itself', (ua) => {
    expect(isLinkPreviewBot(ua)).toBe(false);
  });
});

describe('templateLinkResult', () => {
  const original = process.env.PUBLIC_ORIGIN;
  beforeEach(() => {
    process.env.PUBLIC_ORIGIN = 'https://app.teable.ai/';
  });
  afterEach(() => {
    process.env.PUBLIC_ORIGIN = original;
  });

  it('redirects a person, even with a preview at hand', () => {
    const ctx = context('Mozilla/5.0 Chrome/131.0 Safari/537.36');
    const result = templateLinkResult(ctx, '/base/bseLive', preview);

    expect(result).toEqual({ redirect: { destination: '/base/bseLive', permanent: false } });
    // the same URL answers a crawler with a page: caches must not mix them up
    expect(ctx.res.setHeader).toHaveBeenCalledWith('Vary', 'User-Agent');
  });

  it('gives a crawler the meta tags of the template, with absolute URLs', () => {
    const result = templateLinkResult(context('Twitterbot/1.0'), '/base/bseLive', preview);

    expect(result).toEqual({
      props: {
        preview: {
          title: 'Lotus Yoga',
          description: 'Class booking for yoga studios.',
          image: 'https://app.teable.ai/api/attachments/read/public/template/cover.png',
          url: 'https://app.teable.ai/s/k3Pq9xYb2',
          destination: 'https://app.teable.ai/base/bseLive',
        },
      },
    });
  });

  it('keeps an image that storage already serves from elsewhere', () => {
    const result = templateLinkResult(context('LinkedInBot/1.0'), '/base/bseLive', {
      ...preview,
      image: 'https://storage.example/public/template/cover.png',
    });

    expect(result).toMatchObject({
      props: { preview: { image: 'https://storage.example/public/template/cover.png' } },
    });
  });

  it('redirects a crawler too when the link is not a template link', () => {
    const result = templateLinkResult(context('Twitterbot/1.0'), '/share/shr1/view', undefined);

    expect(result).toEqual({ redirect: { destination: '/share/shr1/view', permanent: false } });
  });
});

describe('isTemplateUnavailable', () => {
  it('recognises the backend answer for a withdrawn or refused template', () => {
    expect(isTemplateUnavailable({ status: 403, data: { templateUnavailable: true } })).toBe(true);
  });

  it('does not mistake other failures for it', () => {
    expect(isTemplateUnavailable({ status: 404, data: {} })).toBe(false);
    expect(isTemplateUnavailable(new Error('boom'))).toBe(false);
    expect(isTemplateUnavailable(null)).toBe(false);
  });
});
