import type { IFieldVo } from '@teable/core';
import { HttpErrorCode } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../../custom.exception';
import { rawField2FieldObj } from './factory';

export async function readStoredField(
  prisma: Prisma.TransactionClient,
  tableId: string,
  fieldId: string
): Promise<IFieldVo> {
  const field = await prisma.field.findFirst({
    where: { id: fieldId, tableId, deletedTime: null },
  });
  if (!field) {
    throw new CustomHttpException(
      `Field ${fieldId} not found in table ${tableId}`,
      HttpErrorCode.NOT_FOUND,
      {
        localization: {
          i18nKey: 'httpErrors.field.notFoundInTable',
          context: { tableId, fieldId },
        },
      }
    );
  }
  const fieldVo = rawField2FieldObj(field);
  delete fieldVo.meta;
  return fieldVo;
}
