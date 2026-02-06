import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  FieldId,
  FieldType,
  v2CoreTokens,
  type ICommandBus,
  type Table,
  type Field,
  type DomainError,
} from '@teable/v2-core';
import { ok, type Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FormulaSqlPgExpressionBuilder } from './FormulaSqlPgExpressionBuilder';
import { FormulaSqlPgTranslator } from './FormulaSqlPgTranslator';
import { makeExpr, type SqlExpr } from './SqlExpression';
import { Pg16TypeValidationStrategy } from './strategies';
import { createFormulaTestContainer } from './testkit/FormulaSqlPgTestkit';

class TestExpressionBuilder extends FormulaSqlPgExpressionBuilder {
  public normalizeArray(expr: SqlExpr): string {
    return this.normalizeArrayExpr(expr);
  }
}

describe('lookup array normalization', () => {
  let container: IV2NodeTestContainer;
  let hostTable: Table;
  let lookupField: Field;
  let builder: TestExpressionBuilder;

  beforeAll(async () => {
    container = await createFormulaTestContainer();
    const baseId = container.baseId.toString();

    const foreignPrimaryId = generateFieldId('foreign-primary');
    const foreignTable = await createTable(container, {
      baseId,
      name: 'LookupNormalizationForeign',
      fields: [
        {
          type: 'singleLineText',
          id: foreignPrimaryId,
          name: 'ForeignPrimary',
          isPrimary: true,
        },
      ],
    });

    const linkFieldId = generateFieldId('link');
    hostTable = await createTable(container, {
      baseId,
      name: 'LookupNormalizationHost',
      fields: [
        {
          type: 'singleLineText',
          id: generateFieldId('host-primary'),
          name: 'HostPrimary',
          isPrimary: true,
        },
        {
          type: 'link',
          id: linkFieldId,
          name: 'LinkType',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id().toString(),
            lookupFieldId: foreignPrimaryId,
            isOneWay: true,
          },
        },
      ],
    });

    hostTable = await createLookupField(container, {
      baseId,
      tableId: hostTable.id().toString(),
      name: 'LookupType',
      linkFieldId,
      foreignTableId: foreignTable.id().toString(),
      lookupFieldId: foreignPrimaryId,
    });

    const translator = new FormulaSqlPgTranslator({
      table: hostTable,
      tableAlias: 't',
      typeValidationStrategy: new Pg16TypeValidationStrategy(),
      resolveFieldSql: () =>
        ok(makeExpr('NULL', 'unknown', false, undefined, undefined, undefined, 'scalar')),
    });
    builder = new TestExpressionBuilder(translator);
    lookupField = hostTable.getFields().find((field) => field.name().toString() === 'LookupType')!;
  });

  afterAll(async () => {
    await container.dispose();
  });

  it('normalizes blank text for lookup arrays without jsonb cast errors', () => {
    const expr = makeExpr("''", 'string', true, undefined, undefined, lookupField, 'array');
    const normalized = builder.normalizeArray(expr);

    // Should handle empty string safely with pg_typeof checks
    expect(normalized).toContain('pg_typeof');
    expect(normalized).toContain("'[]'::jsonb");
    // Should not have bare ''::jsonb which would fail
    expect(normalized).not.toContain("''::jsonb");
  });
});

const unwrapOrThrow = <T>(result: Result<T, DomainError>, label: string): T => {
  if (result.isErr()) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

const generateFieldId = (label: string): string =>
  unwrapOrThrow(FieldId.generate(), `FieldId.generate(${label})`).toString();

const executeCommand = async <TResult>(
  container: IV2NodeTestContainer,
  command: unknown
): Promise<TResult> => {
  const commandBus = container.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  const context = { actorId: unwrapOrThrow(ActorId.create('system'), 'ActorId.create(system)') };
  const result = await commandBus.execute(context, command);
  return unwrapOrThrow(result as Result<TResult, DomainError>, 'CommandBus.execute');
};

const createTable = async (
  container: IV2NodeTestContainer,
  params: {
    baseId: string;
    name: string;
    fields: Array<Record<string, unknown>>;
  }
): Promise<Table> => {
  const command = unwrapOrThrow(
    CreateTableCommand.create({
      baseId: params.baseId,
      name: params.name,
      fields: params.fields,
    }),
    `CreateTableCommand(${params.name})`
  );
  const result = await executeCommand<{ table: Table }>(container, command);
  return result.table;
};

const createLookupField = async (
  container: IV2NodeTestContainer,
  params: {
    baseId: string;
    tableId: string;
    name: string;
    linkFieldId: string;
    foreignTableId: string;
    lookupFieldId: string;
  }
): Promise<Table> => {
  const command = unwrapOrThrow(
    CreateFieldCommand.create({
      baseId: params.baseId,
      tableId: params.tableId,
      field: {
        type: 'lookup',
        id: generateFieldId('lookup'),
        name: params.name,
        options: {
          linkFieldId: params.linkFieldId,
          foreignTableId: params.foreignTableId,
          lookupFieldId: params.lookupFieldId,
        },
      },
    }),
    `CreateFieldCommand(${params.name})`
  );
  const result = await executeCommand<{ table: Table }>(container, command);
  return result.table;
};
