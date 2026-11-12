import {
  ActorId,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type IRecordQueryPlugin,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { DataQueryDefinition } from './DataQueryDefinition';
import { DataQueryExplainService } from './DataQueryExplainService';

const rootTableId = `tbl${'a'.repeat(16)}`;
const ownerTableId = `tbl${'b'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const numberId = `fld${'b'.repeat(16)}`;
const secretId = `fld${'c'.repeat(16)}`;
const linkId = `fld${'d'.repeat(16)}`;
const mapper = new DefaultTableMapper();
const context = { actorId: ActorId.create('reader')._unsafeUnwrap() };

const tableDto = (id: string): ITablePersistenceDTO => ({
  id,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Explain authorization fixture',
  dbTableName: `explain.${id}`,
  primaryFieldId: titleId,
  fields: [
    { id: titleId, name: 'Title', dbFieldName: 'title', type: 'singleLineText' },
    { id: numberId, name: 'Amount', dbFieldName: 'amount', type: 'number' },
    { id: secretId, name: 'Secret', dbFieldName: 'secret', type: 'singleLineText' },
    ...(id === rootTableId
      ? [
          {
            id: linkId,
            name: 'Owner',
            dbFieldName: 'owner',
            type: 'link' as const,
            options: {
              relationship: 'manyOne' as const,
              foreignTableId: ownerTableId,
              lookupFieldId: titleId,
              isOneWay: true,
              fkHostTableName: `explain.${rootTableId}`,
              selfKeyName: '__id',
              foreignKeyName: 'fk_owner',
            },
          },
        ]
      : []),
  ],
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

describe('expression explain authorization', () => {
  it.each(['when', 'then', 'else'] as const)(
    'authorizes denied IF %s fields before root formula diagnostics',
    async (position) => {
      const table = mapper.toDomain(tableDto(rootTableId))._unsafeUnwrap();
      let denied = true;
      const plugin: IRecordQueryPlugin = {
        name: 'explain-field-scope',
        supports: () => true,
        scope: () => ok(denied ? { readableFieldIds: new Set([titleId, numberId, linkId]) } : {}),
      };
      const explain = vi.fn(async () => {
        throw new Error('Invalid queries must not reach the explainer');
      });
      const service = new DataQueryExplainService(
        { findOne: async () => ok(table) },
        new RecordQueryPluginRunner([plugin], new NoopLogger()),
        { explain }
      );
      const definition = DataQueryDefinition.create({
        version: 3,
        kind: 'records',
        tableId: rootTableId,
        select: [
          {
            alias: 'caption',
            expr: {
              type: 'formula',
              // The first IF has invalid arity; all declared branches must still be authorized first.
              formula: `CONCATENATE(IF({amount}, 1), IF(${position === 'when' ? '{secret}' : '"enabled"'} = "enabled", ${position === 'then' ? '{secret}' : '"shown"'}, ${position === 'else' ? '{secret}' : '"hidden"'}))`,
              references: {
                amount: { type: 'field', fieldId: numberId },
                secret: { type: 'field', fieldId: secretId },
              },
            },
          },
        ],
      })._unsafeUnwrap();
      const result = await service.explain(context, definition);
      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'data_query.field_forbidden',
        tags: ['forbidden'],
      });
      expect(explain).not.toHaveBeenCalled();
      denied = false;
      expect((await service.explain(context, definition))._unsafeUnwrapErr().code).toBe(
        'validation.invalid'
      );
    }
  );

  it('authorizes every relation formula reference before relation binding can reveal type diagnostics', async () => {
    const root = mapper.toDomain(tableDto(rootTableId))._unsafeUnwrap();
    const owner = mapper.toDomain(tableDto(ownerTableId))._unsafeUnwrap();
    let denied = true;
    const plugin: IRecordQueryPlugin = {
      name: 'explain-relation-field-scope',
      supports: () => true,
      scope: (pluginContext) =>
        ok(
          denied && pluginContext.table.id().toString() === ownerTableId
            ? { readableFieldIds: new Set([titleId, numberId]) }
            : {}
        ),
    };
    const explain = vi.fn(async () => {
      throw new Error('Relation query must not use root explainer');
    });
    const explainRelation = vi.fn(async () => {
      throw new Error('Invalid query must not reach relation explainer');
    });
    let loadCount = 0;
    const service = new DataQueryExplainService(
      { findOne: async () => ok(loadCount++ % 2 === 0 ? root : owner) },
      new RecordQueryPluginRunner([plugin], new NoopLogger()),
      { explain, explainRelation }
    );
    const definition = DataQueryDefinition.create({
      version: 3,
      kind: 'records',
      tableId: rootTableId,
      relations: {
        owner: {
          linkFieldId: linkId,
          tableId: ownerTableId,
          filter: {
            type: 'formula',
            formula: 'NOT({secret} = BLANK())',
            references: { secret: { type: 'field', fieldId: secretId } },
          },
        },
      },
      select: [
        {
          alias: 'caption',
          expr: {
            type: 'formula',
            formula: 'CONCATENATE(IF({amount}, 1), {secret})',
            references: {
              amount: { type: 'field', fieldId: numberId },
              secret: { type: 'field', source: 'owner', fieldId: secretId },
            },
          },
        },
      ],
    })._unsafeUnwrap();
    const result = await service.explain(context, definition);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'data_query.field_forbidden',
      details: { fieldId: secretId },
    });
    expect(explain).not.toHaveBeenCalled();
    expect(explainRelation).not.toHaveBeenCalled();
    denied = false;
    expect((await service.explain(context, definition))._unsafeUnwrapErr().code).toBe(
      'validation.invalid'
    );
  });
});
