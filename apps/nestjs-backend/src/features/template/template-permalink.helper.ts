import { HttpErrorCode } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';

/**
 * Resolve the landing URL of a published template.
 * Shared by the /t permalink endpoint and short-link resolution, which redirects
 * straight to this URL instead of bouncing through the /t page (T6802).
 */
export const resolveTemplateRedirectUrl = async (
  prisma: Prisma.TransactionClient,
  templateId: string
): Promise<string> => {
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    select: {
      publishInfo: true,
      snapshot: true,
      isPublished: true,
      id: true,
    },
  });

  if (!template) {
    throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND);
  }

  if (!template.isPublished) {
    throw new CustomHttpException('Template is not published', HttpErrorCode.RESTRICTED_RESOURCE);
  }

  const snapshot = template.snapshot ? JSON.parse(template.snapshot) : {};
  const publishInfo = template.publishInfo as { defaultUrl?: string } | null;
  const snapshotBaseId = snapshot.baseId;

  if (!snapshotBaseId) {
    throw new CustomHttpException(
      'Template snapshot is invalid',
      HttpErrorCode.UNPROCESSABLE_ENTITY
    );
  }

  return publishInfo?.defaultUrl || `/base/${snapshotBaseId}`;
};
