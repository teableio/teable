import type { Prisma } from '@teable/db-main-prisma';
import { TemplateReviewStatus } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import {
  detailManifest,
  resolveTemplateLanding,
  resolveTemplateRedirectUrl,
} from './template-permalink.helper';

vi.mock('../attachments/plugins/utils', () => ({
  getPublicFullStorageUrl: (path: string) => `https://storage.example/public/${path}`,
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'tpl1',
  name: 'Lotus Yoga',
  description: 'Class booking for yoga studios.',
  cover: JSON.stringify({ path: 'template/cover.png', token: 'tok' }),
  publishInfo: null,
  snapshot: null,
  isPublished: false,
  history: null,
  review: null,
  ...over,
});

const history = [{ version: 1, publishedTime: '2026-11-16T00:00:00.000Z' }];

const review = (status: TemplateReviewStatus, over: Record<string, unknown> = {}) => ({
  snapshotBaseId: 'bseSubmitted',
  status,
  checks: [],
  submittedTime: '2026-11-16T00:00:00.000Z',
  submittedBy: 'usrAuthor',
  ...over,
});

const prismaWith = (template: unknown) =>
  ({
    template: { findUnique: vi.fn().mockResolvedValue(template) },
  }) as unknown as Prisma.TransactionClient;

describe('resolveTemplateLanding', () => {
  it('opens the published snapshot of a live template, with its preview', async () => {
    const landing = await resolveTemplateLanding(
      prismaWith(
        row({
          isPublished: true,
          snapshot: JSON.stringify({ baseId: 'bseLive' }),
          publishInfo: { defaultUrl: '/base/bseLive/table/tblA/viwA' },
        })
      ),
      'tpl1'
    );

    expect(landing).toEqual({
      redirectUrl: '/base/bseLive/table/tblA/viwA',
      underReview: false,
      preview: {
        title: 'Lotus Yoga',
        description: 'Class booking for yoga studios.',
        image: 'https://storage.example/public/template/cover.png',
      },
    });
  });

  it.each([TemplateReviewStatus.Review, TemplateReviewStatus.Rejected])(
    'opens a published template the template centre does not list (review %s)',
    async (status) => {
      const url = await resolveTemplateRedirectUrl(
        prismaWith(
          row({
            snapshot: JSON.stringify({ baseId: 'bseLive' }),
            history,
            review: review(status, { snapshotBaseId: 'bseLive' }),
          })
        ),
        'tpl1'
      );

      expect(url).toBe('/base/bseLive');
    }
  );

  it('opens a submission made before publishing went live on submit, while it waits', async () => {
    const landing = await resolveTemplateLanding(
      prismaWith(
        row({
          review: review(TemplateReviewStatus.Review, {
            publishInfo: { defaultUrl: '/base/bseSubmitted/table/tblB/viwB' },
          }),
        })
      ),
      'tpl1'
    );

    expect(landing.redirectUrl).toBe('/base/bseSubmitted/table/tblB/viwB');
    expect(landing.underReview).toBe(true);
    expect(landing.preview.title).toBe('Lotus Yoga');
  });

  it('falls back to the submitted snapshot base when the submission names no landing view', async () => {
    const url = await resolveTemplateRedirectUrl(
      prismaWith(row({ review: review(TemplateReviewStatus.Review) })),
      'tpl1'
    );

    expect(url).toBe('/base/bseSubmitted');
  });

  it.each([
    ['taken down by its author', { history }],
    [
      'refused before publishing went live on submit',
      { review: review(TemplateReviewStatus.Rejected) },
    ],
    ['withdrawn', { review: review(TemplateReviewStatus.Withdrawn) }],
    ['never submitted', {}],
    [
      'a draft with a snapshot that never went out',
      { snapshot: JSON.stringify({ baseId: 'bseDraft' }) },
    ],
  ])('tells a template %s apart from an unknown one', async (_label, state) => {
    await expect(resolveTemplateLanding(prismaWith(row(state)), 'tpl1')).rejects.toMatchObject({
      status: 403,
      data: { templateUnavailable: true },
    });
  });

  it('answers not found for an id no template has', async () => {
    const error = await resolveTemplateLanding(prismaWith(null), 'tplNope').catch((e) => e);

    expect(error).toMatchObject({ status: 404 });
    expect(error.data?.templateUnavailable).toBeUndefined();
  });

  it('leaves the image out of a preview when the template has no cover', async () => {
    const landing = await resolveTemplateLanding(
      prismaWith(
        row({
          cover: null,
          isPublished: true,
          snapshot: JSON.stringify({ baseId: 'bseLive' }),
        })
      ),
      'tpl1'
    );

    expect(landing.preview).toEqual({
      title: 'Lotus Yoga',
      description: 'Class booking for yoga studios.',
    });
  });
});

describe('detailManifest', () => {
  const live = { components: ['live'] };
  const pending = { components: ['pending'] };
  const snapshot = JSON.stringify({ baseId: 'bseLive' });

  it('describes a published template by its manifest, whatever its review', () => {
    expect(
      detailManifest({
        snapshot,
        manifest: live,
        review: review(TemplateReviewStatus.Review, { manifest: pending }),
      })
    ).toEqual(live);
  });

  it('describes a submission not live yet by its own manifest, not one left on the row', () => {
    expect(
      detailManifest({
        snapshot: null,
        manifest: live,
        review: review(TemplateReviewStatus.Review, { manifest: pending }),
      })
    ).toEqual(pending);
  });

  it('has none for a submission that carries none', () => {
    expect(
      detailManifest({
        snapshot: null,
        manifest: null,
        review: review(TemplateReviewStatus.Review),
      })
    ).toBeNull();
  });
});
