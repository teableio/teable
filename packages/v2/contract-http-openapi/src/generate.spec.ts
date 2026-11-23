import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { generateV2OpenApiDocument } from './generate';

describe('public operation schemas', () => {
  it('documents the IDs, table DTO and error envelope for tables.get', async () => {
    const document = await generateV2OpenApiDocument();
    const operation = document.paths?.['/tables/get']?.get;
    expect(operation?.parameters).toEqual(
      expect.arrayContaining(
        ['baseId', 'tableId'].map((name) =>
          expect.objectContaining({ name, in: 'query', required: true, schema: { type: 'string' } })
        )
      )
    );

    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    ajv.addSchema(document, 'urn:teable:table-docs');
    const response = (status: number) =>
      ajv.compile({
        $ref: `urn:teable:table-docs#/paths/~1tables~1get/get/responses/${status}/content/application~1json/schema`,
      });
    const acceptsTable = response(200);
    const table = { id: 'tbl1', baseId: 'bse1', name: 'Tasks', fields: [], views: [] };
    expect(acceptsTable({ ok: true, data: { table } })).toBe(true);
    expect(acceptsTable({ ok: true, data: { table: { ...table, fields: 'invalid' } } })).toBe(
      false
    );
    expect(acceptsTable({ ok: true, data: {} })).toBe(false);

    const acceptsError = response(402);
    expect(acceptsError({ ok: false, error: 'Payment required' })).toBe(true);
    expect(
      acceptsError({ ok: false, error: { code: 'quota', message: 'Quota exceeded', tags: [] } })
    ).toBe(true);
    expect(acceptsError({ ok: false, error: { code: 'quota' } })).toBe(false);
  });

  it('publishes the insert payload on POST /tables/createRecord', async () => {
    const document = await generateV2OpenApiDocument();
    const body = document.paths?.['/tables/createRecord']?.post?.requestBody;
    if (!body || '$ref' in body) throw new Error('Missing create record body');
    expect(body.content['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { tableId: { type: 'string' }, fields: { type: 'object' } },
      required: ['tableId'],
    });
  });
});
