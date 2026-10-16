import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import type {
  IConditionalRollupFieldOptions,
  IFieldRo,
  IFieldVo,
  ILookupOptionsRo,
} from '@teable/core';
import {
  Colors,
  FieldType,
  NumberFormattingType,
  Relationship,
  SingleNumberDisplayType,
} from '@teable/core';
import { axios } from '@teable/openapi';
import { ActorId, type IComputedUpdateDrainService, v2CoreTokens } from '@teable/v2-core';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  createTable,
  getField,
  getRecord,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
} from './utils/init-app';

// Fixtures below keep the reported field shapes (source select, lookup of a number,
// linked rollup, formula with currency formatting) and the PATCH payloads, without
// copying customer identifiers or record data.
describe('Field PATCH options (v2)', () => {
  let app: INestApplication;
  let v2ContainerService: V2ContainerService;
  const baseId = globalThis.testConfig.baseId;
  const tableIds: string[] = [];

  beforeAll(async () => {
    ({ app } = await initApp());
    v2ContainerService = app.get(V2ContainerService);
  });

  afterEach(async () => {
    for (const tableId of tableIds.reverse()) {
      await permanentDeleteTable(baseId, tableId);
    }
    tableIds.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const table = async (fields: IFieldRo[]) => {
    const created = await createTable(baseId, { name: 'Patch options', fields, records: [] });
    tableIds.push(created.id);
    return created;
  };

  const patchOptions = async (tableId: string, fieldId: string, body: unknown) => {
    return axios.patch(`/table/${tableId}/field/${fieldId}`, body, {
      validateStatus: () => true,
    });
  };

  // Field options arrive as a per-type union; read a single key off the runtime object.
  const optionValue = (options: unknown, key: string): unknown => {
    if (options == null || typeof options !== 'object') return undefined;
    return Object.entries(options).find(([optionKey]) => optionKey === key)?.[1];
  };

  const selectChoiceNames = (field: IFieldVo): string[] => {
    const raw = optionValue(field.options, 'choices');
    if (!Array.isArray(raw)) return [];
    return raw.map((choice) =>
      choice && typeof choice === 'object' && 'name' in choice
        ? String(choice.name)
        : String(choice)
    );
  };

  const lookupFieldId = (field: IFieldVo): string | undefined => {
    const value = optionValue(field.lookupOptions, 'lookupFieldId');
    return typeof value === 'string' ? value : undefined;
  };

  // Link/conditional-rollup keep the foreign table in `options`, the lookup family in
  // `lookupOptions`; normalizeFieldVo leaves each on the shape the v1 contract uses.
  const foreignTableIdOf = (field: IFieldVo): string | undefined => {
    const lookupValue = optionValue(field.lookupOptions, 'foreignTableId');
    if (typeof lookupValue === 'string') return lookupValue;
    const optionsValue = optionValue(field.options, 'foreignTableId');
    return typeof optionsValue === 'string' ? optionsValue : undefined;
  };

  const drainComputed = async () => {
    const container = await v2ContainerService.getContainer();
    const drainService = container.resolve<IComputedUpdateDrainService>(
      v2CoreTokens.computedUpdateDrainService
    );
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    for (let i = 0; i < 5; i++) {
      const result = await drainService.drainOnce(context, { workerId: 'test-worker', limit: 100 });
      if (result.isErr()) throw new Error(result.error.message);
      if (result.value === 0) break;
    }
  };

  const recordValue = async (
    tableId: string,
    recordId: string,
    fieldId: string,
    expected: unknown
  ): Promise<unknown> => {
    const deadline = Date.now() + 10000;
    let value: unknown;
    for (;;) {
      await drainComputed();
      value = (await getRecord(tableId, recordId)).fields[fieldId];
      if (JSON.stringify(value) === JSON.stringify(expected)) return value;
      if (Date.now() > deadline) return value;
      await delay(50);
    }
  };

  // Shared fixture: products (price/stock/select) linked from orders. The lookups
  // follow a many-one link so their values are scalar, like the reported cases; the
  // rollup follows a many-many link because it aggregates several products.
  const buildFixture = async () => {
    const products = await table([
      { name: 'Name', type: FieldType.SingleLineText },
      {
        name: 'Price',
        type: FieldType.Number,
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
      },
      {
        name: 'Stock',
        type: FieldType.Number,
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
      },
      {
        name: 'Category',
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { name: 'Fruit', color: Colors.Blue },
            { name: 'Citrus', color: Colors.Orange },
          ],
        },
      },
    ]);
    const [name, price, stock, category] = products.fields;

    const orders = await table([{ name: 'Order No', type: FieldType.SingleLineText }]);

    const link = await createField(orders.id, {
      name: 'Product',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: products.id,
        lookupFieldId: name.id,
      },
    });
    const manyLink = await createField(orders.id, {
      name: 'Products',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: products.id,
        lookupFieldId: name.id,
      },
    });
    const categoryLookup = await createField(orders.id, {
      name: 'Category Lookup',
      type: FieldType.SingleSelect,
      isLookup: true,
      lookupOptions: {
        foreignTableId: products.id,
        linkFieldId: link.id,
        lookupFieldId: category.id,
      },
    });
    const priceLookup = await createField(orders.id, {
      name: 'Price Lookup',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: products.id,
        linkFieldId: link.id,
        lookupFieldId: price.id,
      },
    });
    const priceLookupMany = await createField(orders.id, {
      name: 'Price Lookup Many',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: {
        foreignTableId: products.id,
        linkFieldId: manyLink.id,
        lookupFieldId: price.id,
      },
    });
    const total = await createField(orders.id, {
      name: 'Total',
      type: FieldType.Rollup,
      options: { expression: 'sum({values})' },
      lookupOptions: {
        foreignTableId: products.id,
        linkFieldId: manyLink.id,
        lookupFieldId: price.id,
      },
    });

    return {
      products,
      orders,
      name,
      price,
      stock,
      category,
      link,
      manyLink,
      categoryLookup,
      priceLookup,
      priceLookupMany,
      total,
    };
  };

  // A conditional rollup aggregates the products table directly (no link) so a PATCH can
  // re-point the source field without touching a link column.
  const buildConditionalRollupFixture = async () => {
    const fixture = await buildFixture();
    await createRecords(fixture.products.id, {
      records: [
        { fields: { [fixture.name.id]: 'Apple', [fixture.price.id]: 10, [fixture.stock.id]: 5 } },
        { fields: { [fixture.name.id]: 'Banana', [fixture.price.id]: 20, [fixture.stock.id]: 6 } },
        { fields: { [fixture.name.id]: 'Orange', [fixture.price.id]: 30, [fixture.stock.id]: 7 } },
      ],
    });
    const conditional = await createField(fixture.orders.id, {
      name: 'Conditional Price Sum',
      type: FieldType.ConditionalRollup,
      options: {
        expression: 'sum({values})',
        foreignTableId: fixture.products.id,
        lookupFieldId: fixture.price.id,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: fixture.price.id, operator: 'isGreater', value: 0 }],
        },
      } as IConditionalRollupFieldOptions,
    } as IFieldRo);
    const order = await createRecords(fixture.orders.id, {
      records: [{ fields: { [fixture.orders.fields[0].id]: 'O1' } }],
    });
    return { fixture, conditional, orderId: order.records[0].id };
  };

  it('Y2912 applies single select choices through PATCH and syncs the lookup', async () => {
    const fixture = await buildFixture();
    const current = await getField(fixture.products.id, fixture.category.id);

    const response = await patchOptions(fixture.products.id, fixture.category.id, {
      options: {
        choices: [
          ...selectChoiceNames(current).map((name) => ({ name })),
          { name: 'Berry', color: Colors.Green },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');

    const source = await getField(fixture.products.id, fixture.category.id);
    expect(selectChoiceNames(source)).toEqual(['Fruit', 'Citrus', 'Berry']);

    const lookup = await getField(fixture.orders.id, fixture.categoryLookup.id);
    expect(selectChoiceNames(lookup)).toEqual(['Fruit', 'Citrus', 'Berry']);
  });

  it('Y2913 applies lookup formatting and showAs through PATCH', async () => {
    const fixture = await buildFixture();
    const response = await patchOptions(fixture.orders.id, fixture.priceLookup.id, {
      options: {
        formatting: { type: NumberFormattingType.Decimal, precision: 3 },
        showAs: {
          type: SingleNumberDisplayType.Bar,
          color: Colors.Green,
          showValue: true,
          maxValue: 100,
        },
      },
    });
    expect(response.status).toBe(200);

    const lookup = await getField(fixture.orders.id, fixture.priceLookup.id);
    expect(optionValue(lookup.options, 'formatting')).toEqual({
      type: NumberFormattingType.Decimal,
      precision: 3,
    });
    expect(optionValue(lookup.options, 'showAs')).toEqual({
      type: SingleNumberDisplayType.Bar,
      color: Colors.Green,
      showValue: true,
      maxValue: 100,
    });
  });

  it('Y2927 applies rollup expression and source field through PATCH with recompute', async () => {
    const fixture = await buildFixture();
    const { records } = await createRecords(fixture.products.id, {
      records: [
        { fields: { [fixture.name.id]: 'Apple', [fixture.price.id]: 10, [fixture.stock.id]: 5 } },
        { fields: { [fixture.name.id]: 'Banana', [fixture.price.id]: 20, [fixture.stock.id]: 6 } },
        { fields: { [fixture.name.id]: 'Orange', [fixture.price.id]: 30, [fixture.stock.id]: 7 } },
      ],
    });
    const order = await createRecords(fixture.orders.id, {
      records: [
        {
          fields: {
            [fixture.orders.fields[0].id]: 'O1',
            [fixture.manyLink.id]: records.map((record) => ({ id: record.id })),
          },
        },
      ],
    });
    const orderId = order.records[0].id;
    expect(await recordValue(fixture.orders.id, orderId, fixture.total.id, 60)).toBe(60);

    const expressionResponse = await patchOptions(fixture.orders.id, fixture.total.id, {
      options: { expression: 'max({values})' },
    });
    expect(expressionResponse.status).toBe(200);
    const updated = await getField(fixture.orders.id, fixture.total.id);
    expect(optionValue(updated.options, 'expression')).toBe('max({values})');
    expect(await recordValue(fixture.orders.id, orderId, fixture.total.id, 30)).toBe(30);

    const sourceResponse = await patchOptions(fixture.orders.id, fixture.total.id, {
      options: { expression: 'max({values})' },
      lookupOptions: { lookupFieldId: fixture.stock.id },
    });
    expect(sourceResponse.status).toBe(200);
    const withStock = await getField(fixture.orders.id, fixture.total.id);
    expect(lookupFieldId(withStock)).toBe(fixture.stock.id);
    expect(await recordValue(fixture.orders.id, orderId, fixture.total.id, 7)).toBe(7);
  });

  it('Y2939 applies a formula expression through PATCH and preserves formatting', async () => {
    const fixture = await buildFixture();
    const formula = await createField(fixture.products.id, {
      name: 'Double Price',
      type: FieldType.Formula,
      options: {
        expression: `{${fixture.price.id}}*2`,
        formatting: { type: NumberFormattingType.Currency, precision: 0, symbol: '¥' },
      },
    });

    const response = await patchOptions(fixture.products.id, formula.id, {
      options: { expression: `{${fixture.price.id}}*3` },
    });
    expect(response.status).toBe(200);

    const updated = await getField(fixture.products.id, formula.id);
    expect(optionValue(updated.options, 'expression')).toBe(`{${fixture.price.id}}*3`);
    expect(optionValue(updated.options, 'formatting')).toEqual({
      type: NumberFormattingType.Currency,
      precision: 0,
      symbol: '¥',
    });
  });

  it('rejects repointing a link, lookup, rollup or conditional variant outside the caller space', async () => {
    const { fixture, conditional: conditionalRollup } = await buildConditionalRollupFixture();
    const conditionalLookup = await createField(fixture.orders.id, {
      name: 'Conditional Price Lookup',
      type: FieldType.Number,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: fixture.products.id,
        lookupFieldId: fixture.price.id,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: fixture.price.id, operator: 'isGreater', value: 0 }],
        },
      } as ILookupOptionsRo,
    } as IFieldRo);

    const otherSpace = await createSpace({ name: 'Patch options other space' });
    let otherBaseId: string | undefined;
    try {
      otherBaseId = (await createBase({ spaceId: otherSpace.id, name: 'Patch options other base' }))
        .id;
      const secret = await createTable(otherBaseId, {
        name: 'Secret',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [],
      });

      const expectCrossSpaceRejected = async (fieldId: string, body: unknown) => {
        const response = await patchOptions(fixture.orders.id, fieldId, body);
        expect(response.status).toBe(400);
        expect(response.headers['x-teable-v2']).toBe('true');
        expect(response.data).toMatchObject({
          data: { localization: { i18nKey: 'httpErrors.field.crossSpaceLinkForbidden' } },
        });
      };

      // A link keeps its foreign table in `options` and its own spec does not reject the
      // re-point, so the guard is the only thing stopping the cross-space link from persisting.
      await expectCrossSpaceRejected(fixture.link.id, {
        options: { foreignTableId: secret.id },
      });
      expect(foreignTableIdOf(await getField(fixture.orders.id, fixture.link.id))).toBe(
        fixture.products.id
      );

      // The lookup family keeps it in `lookupOptions`.
      await expectCrossSpaceRejected(fixture.priceLookup.id, {
        lookupOptions: { foreignTableId: secret.id },
      });
      expect(foreignTableIdOf(await getField(fixture.orders.id, fixture.priceLookup.id))).toBe(
        fixture.products.id
      );
      await expectCrossSpaceRejected(fixture.total.id, {
        lookupOptions: { foreignTableId: secret.id },
      });
      expect(foreignTableIdOf(await getField(fixture.orders.id, fixture.total.id))).toBe(
        fixture.products.id
      );

      // Conditional lookup takes `lookupOptions`, conditional rollup the flat create-shape key.
      await expectCrossSpaceRejected(conditionalLookup.id, {
        lookupOptions: { foreignTableId: secret.id },
      });
      expect(foreignTableIdOf(await getField(fixture.orders.id, conditionalLookup.id))).toBe(
        fixture.products.id
      );
      await expectCrossSpaceRejected(conditionalRollup.id, {
        options: { foreignTableId: secret.id },
      });
      expect(foreignTableIdOf(await getField(fixture.orders.id, conditionalRollup.id))).toBe(
        fixture.products.id
      );
    } finally {
      if (otherBaseId) {
        await permanentDeleteBase(otherBaseId);
      }
      await permanentDeleteSpace(otherSpace.id);
    }
  });

  it('applies conditional rollup flat config keys through PATCH', async () => {
    const { fixture, conditional, orderId } = await buildConditionalRollupFixture();
    expect(await recordValue(fixture.orders.id, orderId, conditional.id, 60)).toBe(60);

    const response = await patchOptions(fixture.orders.id, conditional.id, {
      options: { lookupFieldId: fixture.stock.id },
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');

    const updated = await getField(fixture.orders.id, conditional.id);
    expect(optionValue(updated.options, 'lookupFieldId')).toBe(fixture.stock.id);
    expect(optionValue(updated.options, 'foreignTableId')).toBe(fixture.products.id);
    expect(await recordValue(fixture.orders.id, orderId, conditional.id, 18)).toBe(18);
  });

  it('applies a partial conditional rollup lookupOptions patch over the current config', async () => {
    const { fixture, conditional, orderId } = await buildConditionalRollupFixture();
    expect(await recordValue(fixture.orders.id, orderId, conditional.id, 60)).toBe(60);

    const response = await patchOptions(fixture.orders.id, conditional.id, {
      lookupOptions: { lookupFieldId: fixture.stock.id },
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');

    const updated = await getField(fixture.orders.id, conditional.id);
    expect(optionValue(updated.options, 'lookupFieldId')).toBe(fixture.stock.id);
    expect(optionValue(updated.options, 'foreignTableId')).toBe(fixture.products.id);
    expect(await recordValue(fixture.orders.id, orderId, conditional.id, 18)).toBe(18);
  });

  it('applies conditional lookup display options through PATCH', async () => {
    const fixture = await buildFixture();
    const conditional = await createField(fixture.orders.id, {
      name: 'Conditional Price',
      type: FieldType.Number,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: fixture.products.id,
        lookupFieldId: fixture.price.id,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: fixture.price.id, operator: 'isGreater', value: 0 }],
        },
      } as ILookupOptionsRo,
    } as IFieldRo);

    const response = await patchOptions(fixture.orders.id, conditional.id, {
      options: { formatting: { type: NumberFormattingType.Decimal, precision: 3 } },
    });
    expect(response.status).toBe(200);
    expect(response.headers['x-teable-v2']).toBe('true');

    const updated = await getField(fixture.orders.id, conditional.id);
    expect(optionValue(updated.options, 'formatting')).toEqual({
      type: NumberFormattingType.Decimal,
      precision: 3,
    });
    // The link configuration survives the display-only patch.
    expect(lookupFieldId(updated)).toBe(fixture.price.id);
  });

  it('rejects options the current field type cannot apply', async () => {
    const fixture = await buildFixture();
    const target = await createField(fixture.products.id, {
      name: 'Plain',
      type: FieldType.Number,
    });

    const wrongType = await patchOptions(fixture.products.id, target.id, {
      options: { choices: [{ name: 'Nope' }] },
    });
    expect(wrongType.status).toBe(400);
    expect(wrongType.headers['x-teable-v2']).toBe('true');
    expect(wrongType.data).toMatchObject({
      data: {
        localization: {
          i18nKey: 'httpErrors.field.optionsUnsupportedType',
          context: { name: 'Plain', fieldId: target.id, options: 'choices' },
        },
      },
    });
    expect(selectChoiceNames(await getField(fixture.products.id, target.id))).toEqual([]);

    // A scalar numeric chart cannot describe a multiple-value lookup result.
    const scalarChartOnManyLookup = await patchOptions(
      fixture.orders.id,
      fixture.priceLookupMany.id,
      {
        options: {
          showAs: {
            type: SingleNumberDisplayType.Bar,
            color: Colors.Green,
            showValue: true,
            maxValue: 100,
          },
        },
      }
    );
    expect(scalarChartOnManyLookup.status).toBe(400);
    expect(scalarChartOnManyLookup.data).toMatchObject({
      data: {
        localization: {
          i18nKey: 'httpErrors.field.optionsUnsupportedType',
          context: {
            name: 'Price Lookup Many',
            fieldId: fixture.priceLookupMany.id,
            options: 'showAs',
          },
        },
      },
    });
    expect(
      optionValue((await getField(fixture.orders.id, fixture.priceLookupMany.id)).options, 'showAs')
    ).toBeUndefined();

    // Lookup link configuration is meaningless on a plain stored field.
    const lookupOptionsOnPlainField = await patchOptions(fixture.products.id, target.id, {
      lookupOptions: { lookupFieldId: fixture.price.id },
    });
    expect(lookupOptionsOnPlainField.status).toBe(400);
    expect(lookupOptionsOnPlainField.data).toMatchObject({
      data: {
        localization: {
          i18nKey: 'httpErrors.field.optionsUnsupportedType',
          context: { name: 'Plain', fieldId: target.id, options: 'lookupOptions' },
        },
      },
    });
  });
});
