import { HttpErrorCode } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { isTemplateLive, isUnreleasedSubmission, type ILinkPreview } from '@teable/openapi';
import { CustomHttpException } from '../../custom.exception';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';

export interface ITemplateLanding {
  redirectUrl: string;
  /** Not public yet: the link opens the submission that is waiting for review. */
  underReview: boolean;
  preview: ILinkPreview;
}

/**
 * A template the link can no longer open: taken down by its author, or never let out. Told apart
 * from an unknown id so the link page can say so instead of a bare 404.
 */
export const templateUnavailableError = () =>
  new CustomHttpException('Template is not available', HttpErrorCode.RESTRICTED_RESOURCE, {
    templateUnavailable: true,
    localization: { i18nKey: 'httpErrors.template.unavailable' },
  });

const readJson = <T>(value: unknown): T | undefined => {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return typeof value === 'object' ? (value as T) : undefined;
};

/** Covers live in the public bucket, so the link stays good for as long as the cover does. */
const previewOf = (template: {
  name: string | null;
  description: string | null;
  cover: string | null;
}): ILinkPreview => {
  const cover = readJson<{ path?: string }>(template.cover);
  return {
    title: template.name ?? '',
    description: template.description ?? '',
    ...(cover?.path ? { image: getPublicFullStorageUrl(cover.path) } : {}),
  };
};

/**
 * The manifest a template's detail describes: the published one, or for a submission not live
 * yet its own, read from the review and never written onto the template, so that a later
 * submission is not described by an earlier one.
 */
export const detailManifest = (template: {
  snapshot: string | null;
  manifest: Prisma.JsonValue;
  review: Prisma.JsonValue;
}): Prisma.JsonValue => {
  if (!isUnreleasedSubmission(template)) return template.manifest;
  return (template.review as { manifest?: Prisma.JsonValue }).manifest ?? null;
};

/**
 * Where a template link lands, and what a link preview shows for it. Shared by the /t
 * permalink endpoint and short-link resolution, which redirects straight to the landing
 * instead of bouncing through the /t page (T6802).
 *
 * A published template opens the version that went out, whether or not the template centre
 * lists it: the review after publishing only decides the listing. A submission made before
 * publishing went live on submit opens itself while it waits. Taken down by its author, or a
 * draft that never went out, it is unavailable.
 */
export const resolveTemplateLanding = async (
  prisma: Prisma.TransactionClient,
  templateId: string
): Promise<ITemplateLanding> => {
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      name: true,
      description: true,
      cover: true,
      publishInfo: true,
      snapshot: true,
      isPublished: true,
      history: true,
      review: true,
    },
  });

  if (!template) {
    throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND);
  }

  if (isTemplateLive(template)) {
    const snapshotBaseId = readJson<{ baseId?: string }>(template.snapshot)?.baseId;
    if (!snapshotBaseId) {
      throw new CustomHttpException(
        'Template snapshot is invalid',
        HttpErrorCode.UNPROCESSABLE_ENTITY
      );
    }
    const publishInfo = readJson<{ defaultUrl?: string }>(template.publishInfo);
    return {
      redirectUrl: publishInfo?.defaultUrl || `/base/${snapshotBaseId}`,
      underReview: false,
      preview: previewOf(template),
    };
  }

  const review = readJson<{
    snapshotBaseId?: string;
    publishInfo?: { defaultUrl?: string };
  }>(template.review);
  if (isUnreleasedSubmission(template) && review?.snapshotBaseId) {
    return {
      redirectUrl: review.publishInfo?.defaultUrl || `/base/${review.snapshotBaseId}`,
      underReview: true,
      preview: previewOf(template),
    };
  }

  throw templateUnavailableError();
};

export const resolveTemplateRedirectUrl = async (
  prisma: Prisma.TransactionClient,
  templateId: string
): Promise<string> => (await resolveTemplateLanding(prisma, templateId)).redirectUrl;
