import { BaseId, domainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createMetaValidationContext: vi.fn(),
  createMetaValidationContextFromTables: vi.fn(),
}));

const loadMetaCheckerModule = async () => {
  vi.resetModules();
  vi.doMock('./MetaValidationContext', () => ({
    createMetaValidationContext: mocks.createMetaValidationContext,
    createMetaValidationContextFromTables: mocks.createMetaValidationContextFromTables,
  }));
  return import('./MetaChecker');
};

const asId = (value: string) => ({
  toString: () => value,
});

const createField = (params: {
  id: string;
  name: string;
  type: string;
  accept: () => ReturnType<typeof ok> | ReturnType<typeof err>;
  hasError?: boolean;
}) => ({
  id: () => asId(params.id),
  name: () => asId(params.name),
  type: () => asId(params.type),
  hasError: () => ({ isError: () => params.hasError === true }),
  accept: params.accept,
});

const createTable = (params: {
  id: string;
  name: string;
  fields: ReturnType<typeof createField>[];
}) => ({
  id: () => asId(params.id),
  name: () => asId(params.name),
  getFields: () => params.fields,
});

const collect = async <T>(generator: AsyncGenerator<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of generator) {
    values.push(value);
  }
  return values;
};

describe('MetaChecker', () => {
  it('yields context loading failures from checkTable', async () => {
    const { MetaChecker } = await loadMetaCheckerModule();
    const checker = new MetaChecker({
      tableRepository: {} as never,
      executionContext: {} as never,
    });

    mocks.createMetaValidationContext.mockResolvedValueOnce(
      err(domainError.infrastructure({ message: 'context failed' }))
    );

    const issues = await collect(
      checker.checkTable(
        createTable({ id: 'tbl1', name: 'Projects', fields: [] }) as never,
        BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap()
      )
    );

    expect(issues).toEqual([
      expect.objectContaining({
        category: 'reference',
        severity: 'error',
        message: 'Failed to load validation context: context failed',
      }),
    ]);
  });

  it('handles successful, error, and throwing field validations', async () => {
    const { MetaChecker } = await loadMetaCheckerModule();
    const checker = new MetaChecker({
      tableRepository: {} as never,
      executionContext: {} as never,
    });
    const ctx = { table: { id: () => asId('tbl1') } };
    const fields = [
      createField({
        id: 'fld1',
        name: 'Title',
        type: 'singleLineText',
        accept: () => ok([{ fieldId: 'fld1', message: 'ok' }]),
      }),
      createField({
        id: 'fld2',
        name: 'Score',
        type: 'number',
        accept: () => err(domainError.validation({ message: 'bad config' })),
      }),
      createField({
        id: 'fld3',
        name: 'Broken',
        type: 'formula',
        accept: () => {
          throw new Error('explode');
        },
      }),
    ];

    const issues = await collect(
      checker.checkTableWithContext(
        createTable({ id: 'tbl1', name: 'Projects', fields }) as never,
        ctx as never
      )
    );

    expect(issues).toEqual([
      { fieldId: 'fld1', message: 'ok' },
      expect.objectContaining({
        fieldId: 'fld2',
        message: 'Validation error: bad config',
      }),
      expect.objectContaining({
        fieldId: 'fld3',
        message: 'Unexpected error: Error: explode',
      }),
    ]);
  });

  it('aggregates checkTableAll results and checkTables adds table context', async () => {
    const { MetaChecker, checkTableMeta, checkTableMetaWithTables } = await loadMetaCheckerModule();
    const ctx = { table: { id: () => asId('tblctx') } };
    const table = createTable({
      id: 'tbl9',
      name: 'Stories',
      fields: [
        createField({
          id: 'fld9',
          name: 'Title',
          type: 'singleLineText',
          accept: () => ok([{ fieldId: 'fld9', message: 'healthy' }]),
        }),
      ],
    });
    const checker = new MetaChecker({
      tableRepository: {} as never,
      executionContext: {} as never,
    });

    mocks.createMetaValidationContext.mockResolvedValue(ok(ctx));
    mocks.createMetaValidationContextFromTables.mockReturnValue(ctx);

    const allResult = await checker.checkTableAll(
      table as never,
      BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap()
    );
    const tablesIssues = await collect(
      checker.checkTables([table as never], BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
    );
    const standaloneIssues = await collect(
      checkTableMeta(table as never, BaseId.create(`bse${'d'.repeat(16)}`)._unsafeUnwrap(), {
        tableRepository: {} as never,
        executionContext: {} as never,
      })
    );
    const standaloneWithTablesIssues = await collect(
      checkTableMetaWithTables(
        table as never,
        BaseId.create(`bse${'e'.repeat(16)}`)._unsafeUnwrap(),
        [table as never]
      )
    );

    expect(allResult._unsafeUnwrap()).toMatchObject({
      tableId: 'tbl9',
      tableName: 'Stories',
      checkedFieldCount: 1,
      issues: [{ fieldId: 'fld9', message: 'healthy' }],
    });
    expect(tablesIssues).toEqual([
      expect.objectContaining({
        fieldId: 'fld9',
        tableId: 'tbl9',
        tableName: 'Stories',
      }),
    ]);
    expect(standaloneIssues).toEqual([{ fieldId: 'fld9', message: 'healthy' }]);
    expect(standaloneWithTablesIssues).toEqual([{ fieldId: 'fld9', message: 'healthy' }]);
  });

  it('skips fields already marked hasError in standalone table checks', async () => {
    const { checkTableMetaWithTables } = await loadMetaCheckerModule();
    const accept = vi.fn(() => ok([{ fieldId: 'fldBroken', message: 'should not emit' }]));
    const table = createTable({
      id: 'tblHasError',
      name: 'Stories',
      fields: [
        createField({
          id: 'fldBroken',
          name: 'Broken Lookup',
          type: 'lookup',
          hasError: true,
          accept,
        }),
      ],
    });

    mocks.createMetaValidationContextFromTables.mockReturnValue({ table });

    const issues = await collect(
      checkTableMetaWithTables(
        table as never,
        BaseId.create(`bse${'f'.repeat(16)}`)._unsafeUnwrap(),
        [table as never]
      )
    );

    expect(issues).toEqual([]);
    expect(accept).not.toHaveBeenCalled();
  });
});
