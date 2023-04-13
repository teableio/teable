import type { CellValueType, DbFieldType, FieldType } from '@teable-group/core';
import { nullsToUndefined } from '@teable-group/core';
import type { Field } from '@teable-group/db-main-prisma';
import { sortBy } from 'lodash';
import { prismaClient } from '@/backend/config/container.config';

function rawField2FieldObj(field: Field) {
  return nullsToUndefined({
    ...field,
    type: field.type as FieldType,
    calculatedType: field.calculatedType as FieldType,
    cellValueType: field.cellValueType as CellValueType,
    dbFieldType: field.dbFieldType as DbFieldType,
    options: JSON.parse(field.options as string),
    defaultValue: JSON.parse(field.defaultValue as string),
    columnMeta: JSON.parse(field.columnMeta),
  });
}

export async function getFields(tableId: string, _viewId: string) {
  let viewId = _viewId;
  if (!viewId) {
    const view = await prismaClient.view.findFirstOrThrow({
      where: { tableId },
      select: { id: true },
    });
    viewId = view.id;
  }

  const fieldsPlain = await prismaClient.field.findMany({
    where: { tableId },
  });

  const fields = fieldsPlain.map(rawField2FieldObj);

  return sortBy(fields, (field) => {
    return field.columnMeta[viewId as string].order;
  });
}
