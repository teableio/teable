import { HttpError } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerSideProps as shortLinkProps } from '../../../../../../pages/s/[code]';
import { getServerSideProps as permalinkProps } from '../../../../../../pages/t/[identifier]';

const mocks = vi.hoisted(() => ({
  getTranslationsProps: vi.fn(async () => ({ _nextI18Next: {} })),
  getShortLink: vi.fn(),
  getTemplatePermalink: vi.fn(),
}));

vi.mock('@/lib/withEnv', () => ({ default: <T>(handler: T) => handler }));
vi.mock('@/lib/i18n', () => ({ getTranslationsProps: mocks.getTranslationsProps }));
vi.mock('@/backend/api/rest/ssr-api', () => ({
  SsrApi: class {
    getShortLink = mocks.getShortLink;
    getTemplatePermalink = mocks.getTemplatePermalink;
  },
}));

const unavailable = () =>
  new HttpError({ message: 'Template is not available', data: { templateUnavailable: true } }, 403);
const context = (query: Record<string, string>) => ({
  query,
  req: { headers: {} },
  res: { statusCode: 200, getHeader: () => undefined, setHeader: () => undefined },
});

describe('the template link pages, once the template is unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getShortLink.mockRejectedValue(unavailable());
    mocks.getTemplatePermalink.mockRejectedValue(unavailable());
  });

  it.each([
    ['/s', () => shortLinkProps, { code: 'rlvwsBNYX' }],
    ['/t', () => permalinkProps, { identifier: 'tplLotus' }],
  ])(
    '%s answers 404 with the unavailable page, its translations asked for as a list',
    async (_, page, query) => {
      const ctx = context(query);
      const result = await page()(ctx as never);
      expect(result).toMatchObject({ props: { unavailable: true } });
      expect(ctx.res.statusCode).toBe(404);
      // a bare name throws in the EE build, whose localePath is a function
      expect(mocks.getTranslationsProps).toHaveBeenCalledWith(ctx, ['common']);
    }
  );
});
