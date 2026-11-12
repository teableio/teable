import {
  ActorId,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  type ITableFieldPersistenceDTO,
  type ITablePersistenceDTO,
} from '@teable/v2-core';
import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { DataQueryService } from './DataQueryService';
import { QueryExecutionService } from './QueryExecutionService';

const tableId = `tbl${'a'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const conditionId = `fld${'b'.repeat(16)}`;
const otherwiseId = `fld${'c'.repeat(16)}`;
const unusedId = `fld${'d'.repeat(16)}`;
const mapper = new DefaultTableMapper();
const context = { actorId: ActorId.create('reader')._unsafeUnwrap() };
const tableDto = (): ITablePersistenceDTO => ({
  id: tableId,
  baseId: `bse${'a'.repeat(16)}`,
  name: 'Signature fixture',
  dbTableName: 'signature.original',
  primaryFieldId: titleId,
  fields: [titleId, conditionId, otherwiseId, unusedId].map((id, index) => ({
    id,
    name: `Field ${index}`,
    dbFieldName: `field_${index}`,
    type: 'singleLineText' as const,
  })),
  views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
});

/** A real longText field: no single-line options survive the type change. */
const longTextMetadata = (field: ITableFieldPersistenceDTO): ITableFieldPersistenceDTO => ({
  id: field.id,
  name: field.name,
  dbFieldName: field.dbFieldName,
  type: 'longText',
});

const queryService = (dto: () => ITablePersistenceDTO) =>
  new QueryExecutionService(
    new DataQueryService(
      { findOne: async () => ok(mapper.toDomain(dto())._unsafeUnwrap()) },
      new RecordQueryPluginRunner([], new NoopLogger()),
      {
        execute: async () => {
          throw new Error('Signatures must not read records');
        },
      }
    )
  );

const definition = {
  kind: 'records',
  tableId,
  select: [{ fieldId: titleId, alias: 'title' }],
};
const expressionDefinition = {
  version: 3,
  kind: 'records',
  tableId,
  select: [
    {
      alias: 'title',
      expr: {
        type: 'formula',
        formula: 'IF({condition} = "enabled", LOWER({title}), {otherwise})',
        references: {
          condition: { type: 'field', fieldId: conditionId },
          title: { type: 'field', fieldId: titleId },
          otherwise: { type: 'field', fieldId: otherwiseId },
        },
      },
    },
  ],
};

describe('expression schema signatures', () => {
  it('keeps v1/v2 fingerprints stable and isolates the v3 formula language contract', async () => {
    const service = queryService(tableDto);
    const versions = await Promise.all(
      [1, 2, 3].map(async (version) =>
        (
          await service.validate(context, {
            definition: { ...definition, version },
            includeSchemaSignature: true,
          })
        )._unsafeUnwrap()
      )
    );
    expect(versions[0].outputs).toEqual(versions[1].outputs);
    expect(versions[1].outputs).toEqual(versions[2].outputs);
    expect(versions[0].schemaSignature).toBe(versions[1].schemaSignature);
    expect(versions[2].schemaSignature).not.toBe(versions[1].schemaSignature);
  });

  it('fingerprints all formula branch references, but not physical placement or unrelated fields', async () => {
    let dto = tableDto();
    const service = queryService(() => dto);
    const signature = async () =>
      (
        await service.validate(context, {
          definition: expressionDefinition,
          includeSchemaSignature: true,
        })
      )._unsafeUnwrap().schemaSignature;
    const baseline = await signature();
    dto = {
      ...dto,
      dbTableName: 'signature.moved',
      name: 'Renamed',
      fields: dto.fields.map((field) => ({ ...field, dbFieldName: `moved_${field.dbFieldName}` })),
    };
    expect(await signature()).toBe(baseline);
    dto = {
      ...dto,
      fields: dto.fields.map((field) => (field.id === unusedId ? longTextMetadata(field) : field)),
    };
    expect(await signature()).toBe(baseline);
    for (const fieldId of [conditionId, otherwiseId]) {
      dto = {
        ...tableDto(),
        fields: tableDto().fields.map((field) =>
          field.id === fieldId ? longTextMetadata(field) : field
        ),
      };
      expect(await signature()).not.toBe(baseline);
    }
  });
});
