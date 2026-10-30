import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { duplicateField, getFields } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

const describeV2 = process.env.FORCE_V2_ALL === 'true' ? describe : describe.skip;

const linkedIds = (value: unknown): string[] => {
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !('id' in entry)) return undefined;
      return typeof entry.id === 'string' ? entry.id : undefined;
    })
    .filter((id): id is string => typeof id === 'string')
    .sort();
};

const fieldById = (fields: IFieldVo[], fieldId: string): IFieldVo => {
  const field = fields.find(({ id }) => id === fieldId);
  if (!field) throw new Error(`Missing field ${fieldId}`);
  return field;
};

const linkOptions = (field: IFieldVo): ILinkFieldOptions => {
  if (field.type !== FieldType.Link) throw new Error(`Field ${field.id} is not a link`);
  return field.options as ILinkFieldOptions;
};

describeV2('V2 duplicate reverse one-many link field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('duplicates a two-way many-one reverse field as an independent one-way link with values', async () => {
    const parent = await createTable(baseId, {
      name: `T8231 Parent ${Date.now()}`,
      fields: [{ name: 'Parent name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [],
    });
    const child = await createTable(baseId, {
      name: `T8231 Child ${Date.now()}`,
      fields: [{ name: 'Child name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [],
    });

    try {
      const parentPrimaryId = parent.fields.find(({ isPrimary }) => isPrimary)?.id;
      const childPrimaryId = child.fields.find(({ isPrimary }) => isPrimary)?.id;
      const parentViewId = parent.views[0]?.id;
      if (!parentPrimaryId || !childPrimaryId || !parentViewId) {
        throw new Error('Missing primary field or parent view');
      }

      const parentRecords = await createRecords(parent.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { fields: { [parentPrimaryId]: 'Parent A' } },
          { fields: { [parentPrimaryId]: 'Parent B' } },
          { fields: { [parentPrimaryId]: 'Parent empty' } },
        ],
      });
      const childToParent = await createField(child.id, {
        name: 'Parent',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: parent.id,
          lookupFieldId: parentPrimaryId,
          isOneWay: false,
        },
      });
      const reverseFieldId = linkOptions(childToParent).symmetricFieldId;
      if (!reverseFieldId) throw new Error('Missing reverse one-many field');

      const childRecords = await createRecords(child.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [childPrimaryId]: 'Child 1',
              [childToParent.id]: { id: parentRecords.records[0].id },
            },
          },
          {
            fields: {
              [childPrimaryId]: 'Child 2',
              [childToParent.id]: { id: parentRecords.records[0].id },
            },
          },
          {
            fields: {
              [childPrimaryId]: 'Child 3',
              [childToParent.id]: { id: parentRecords.records[1].id },
            },
          },
          { fields: { [childPrimaryId]: 'Child unlinked' } },
        ],
      });

      const parentFieldsBefore = (await getFields(parent.id)).data;
      const childFieldsBefore = (await getFields(child.id)).data;
      const reverseFieldBefore = fieldById(parentFieldsBefore, reverseFieldId);
      const childLinkBefore = fieldById(childFieldsBefore, childToParent.id);
      const parentRowsBefore = await getRecords(parent.id, { fieldKeyType: FieldKeyType.Id });
      const childRowsBefore = await getRecords(child.id, { fieldKeyType: FieldKeyType.Id });

      expect(reverseFieldBefore.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: child.id,
        isOneWay: false,
        symmetricFieldId: childToParent.id,
      });

      const duplicated = (
        await duplicateField(parent.id, reverseFieldId, {
          name: 'Children copy',
          viewId: parentViewId,
        })
      ).data;

      const parentFieldsAfter = (await getFields(parent.id)).data;
      const childFieldsAfter = (await getFields(child.id)).data;
      const parentRowsAfter = await getRecords(parent.id, { fieldKeyType: FieldKeyType.Id });
      const childRowsAfter = await getRecords(child.id, { fieldKeyType: FieldKeyType.Id });

      expect(duplicated.options).toMatchObject({
        relationship: Relationship.OneMany,
        foreignTableId: child.id,
        isOneWay: true,
      });
      expect(linkOptions(duplicated).symmetricFieldId).toBeUndefined();
      expect(parentFieldsAfter).toHaveLength(parentFieldsBefore.length + 1);
      expect(fieldById(parentFieldsAfter, reverseFieldId)).toEqual(reverseFieldBefore);
      expect(childFieldsAfter).toEqual(childFieldsBefore);
      expect(fieldById(childFieldsAfter, childToParent.id)).toEqual(childLinkBefore);

      const expectedChildrenByParent = new Map([
        [
          parentRecords.records[0].id,
          [childRecords.records[0].id, childRecords.records[1].id].sort(),
        ],
        [parentRecords.records[1].id, [childRecords.records[2].id]],
      ]);
      for (const row of parentRowsAfter.records) {
        const expected = expectedChildrenByParent.get(row.id) ?? [];
        expect(linkedIds(row.fields[reverseFieldId])).toEqual(expected);
        expect(linkedIds(row.fields[duplicated.id])).toEqual(expected);
      }

      expect(parentRowsBefore.records.map(({ id }) => id).sort()).toEqual(
        parentRowsAfter.records.map(({ id }) => id).sort()
      );
      expect(childRowsAfter.records).toEqual(childRowsBefore.records);

      // Editing the copy must use its own relationship storage, not the original FK.
      await updateRecord(parent.id, parentRecords.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [duplicated.id]: [{ id: childRecords.records[3].id }] } },
      });
      const parentRowsAfterEdit = await getRecords(parent.id, { fieldKeyType: FieldKeyType.Id });
      const editedParent = parentRowsAfterEdit.records.find(
        ({ id }) => id === parentRecords.records[0].id
      );
      expect(linkedIds(editedParent?.fields[duplicated.id])).toEqual([childRecords.records[3].id]);
      for (const row of parentRowsAfterEdit.records) {
        expect(linkedIds(row.fields[reverseFieldId])).toEqual(
          expectedChildrenByParent.get(row.id) ?? []
        );
      }
      expect((await getRecords(child.id, { fieldKeyType: FieldKeyType.Id })).records).toEqual(
        childRowsBefore.records
      );
    } finally {
      await permanentDeleteTable(baseId, child.id);
      await permanentDeleteTable(baseId, parent.id);
    }
  });
});
