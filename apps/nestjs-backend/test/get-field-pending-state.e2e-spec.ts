/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  initApp,
  createTable,
  createField,
  getField,
  getFields,
  getRecords,
  createBase,
  deleteBase,
} from './utils/init-app';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// T6581: the single-field GET must report the same pending state as the field
// list GET. On the v2 path it used to hardcode isPending:true for every
// computed field, contradicting the list endpoint and misleading incident
// debugging. The tables below are an anonymized copy of the customer shape: a
// content hub whose computed fields (formula / lookup / rollup) derive from a
// linked team directory.
describe('OpenAPI Get Field pending state consistency (e2e)', () => {
  let app: INestApplication;
  let pendingBaseId: string;
  let teamDirectory: ITableFullVo;
  let contentHub: ITableFullVo;
  let computedFields: IFieldVo[];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    const createdBase = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: 'Get Field Pending State Base',
    });
    pendingBaseId = createdBase.id;

    teamDirectory = await createTable(pendingBaseId, {
      name: 'TeamDirectory',
      fields: [
        { name: 'MemberName', type: FieldType.SingleLineText },
        { name: 'SlackHandle', type: FieldType.SingleLineText },
      ],
      records: [
        { fields: { MemberName: 'Editor One', SlackHandle: '@editor-one' } },
        { fields: { MemberName: 'Editor Two', SlackHandle: '@editor-two' } },
      ],
    });

    contentHub = await createTable(pendingBaseId, {
      name: 'ContentHub',
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
      records: [{ fields: { Title: 'First story' } }],
    });

    const memberNameId = teamDirectory.fields.find((f) => f.name === 'MemberName')!.id;
    const slackHandleId = teamDirectory.fields.find((f) => f.name === 'SlackHandle')!.id;

    const linkField = await createField(contentHub.id, {
      name: 'AssignedEditor',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: teamDirectory.id,
      },
    } as IFieldRo);

    const formulaField = await createField(contentHub.id, {
      name: 'TitleLength',
      type: FieldType.Formula,
      options: { expression: `LEN({${contentHub.fields[0].id}})` },
    } as IFieldRo);

    const lookupField = await createField(contentHub.id, {
      name: 'EditorName',
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: teamDirectory.id,
        linkFieldId: linkField.id,
        lookupFieldId: memberNameId,
      },
    } as IFieldRo);

    const rollupField = await createField(contentHub.id, {
      name: 'EditorSlackHandle',
      type: FieldType.Rollup,
      options: { expression: 'concatenate({values})' },
      lookupOptions: {
        foreignTableId: teamDirectory.id,
        linkFieldId: linkField.id,
        lookupFieldId: slackHandleId,
      },
    } as IFieldRo);

    computedFields = [formulaField, lookupField, rollupField];

    // Wait until every computed field has settled: the formula must have a
    // materialized value and the list endpoint must no longer report pending.
    for (let i = 0; i < 100; i++) {
      const { records } = await getRecords(contentHub.id, { fieldKeyType: FieldKeyType.Id });
      const formulaValue = records[0].fields[formulaField.id];
      const listed = await getFields(contentHub.id);
      const anyPending = computedFields.some(
        (field) => listed.find((f) => f.id === field.id)?.isPending
      );
      if (formulaValue != null && !anyPending) break;
      await sleep(100);
    }
  });

  afterAll(async () => {
    await deleteBase(pendingBaseId);
    await app.close();
  });

  it('single-field GET reports the same pending state as the field list', async () => {
    const listed = await getFields(contentHub.id);

    for (const field of computedFields) {
      const listedField = listed.find((f) => f.id === field.id)!;
      const single = await getField(contentHub.id, field.id);

      expect(single.isComputed).toBe(true);
      // The incident bug: the single-field endpoint reported isPending:true for
      // every computed field while the list endpoint reported the real state.
      expect(Boolean(single.isPending)).toBe(Boolean(listedField.isPending));
    }
  });

  it('settled computed fields are not reported as pending by the single-field GET', async () => {
    const { records } = await getRecords(contentHub.id, { fieldKeyType: FieldKeyType.Id });
    const formulaField = computedFields[0];
    expect(records[0].fields[formulaField.id]).not.toBeNull();

    for (const field of computedFields) {
      const single = await getField(contentHub.id, field.id);
      expect(Boolean(single.isPending)).toBe(false);
    }
  });
});
