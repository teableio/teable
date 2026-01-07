/* eslint-disable @typescript-eslint/naming-convention */
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTablesCommand,
  type CreateTablesResult,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import { tableTemplates } from '@teable/v2-table-templates';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresSchemaIntrospector } from '../context/PostgresSchemaIntrospector';
import { createSchemaChecker } from './SchemaChecker';
import type { SchemaCheckResult } from './SchemaCheckResult';

const formatSchemaErrors = (errors: ReadonlyArray<SchemaCheckResult>): string => {
  const limit = 30;
  const lines = errors.slice(0, limit).map((e) => {
    const details = e.details ? JSON.stringify(e.details) : '';
    return `- ${e.fieldName} (${e.fieldId}) ${e.ruleId}: ${e.message ?? ''} ${details}`.trim();
  });
  const remaining = errors.length - lines.length;
  return [lines.join('\n'), remaining > 0 ? `...and ${remaining} more` : '']
    .filter(Boolean)
    .join('\n');
};

describe('SchemaChecker (template tables)', () => {
  let testContainer: IV2NodeTestContainer;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
  });

  afterAll(async () => {
    await testContainer.dispose();
  });

  it('creates every template and checkTable has no errors', async () => {
    const { container, baseId, db } = testContainer;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();
    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const checker = createSchemaChecker({
      db,
      introspector: new PostgresSchemaIntrospector(db),
      schema: null,
    });

    const failures: Array<{
      templateKey: string;
      tableId: string;
      tableName: string;
      dbTableName: string;
      errors: ReadonlyArray<SchemaCheckResult>;
    }> = [];

    let templateIndex = 0;
    for (const template of tableTemplates) {
      templateIndex += 1;
      const namePrefix = `Template ${template.key} ${templateIndex}`;

      const commandResult = CreateTablesCommand.create(
        template.createInput(baseId.toString(), { namePrefix })
      );
      commandResult._unsafeUnwrap();

      const execResult = await commandBus.execute<CreateTablesCommand, CreateTablesResult>(
        context,
        commandResult._unsafeUnwrap()
      );
      execResult._unsafeUnwrap();

      const createdTables = execResult._unsafeUnwrap().tables;

      for (const table of createdTables) {
        const dbTableNameResult = table.dbTableName().andThen((name) => name.value());
        dbTableNameResult._unsafeUnwrap();

        const errors: SchemaCheckResult[] = [];
        for await (const result of checker.checkTable(table)) {
          if (result.status === 'error') errors.push(result);
        }

        if (errors.length > 0) {
          failures.push({
            templateKey: template.key,
            tableId: table.id().toString(),
            tableName: table.name().toString(),
            dbTableName: dbTableNameResult._unsafeUnwrap(),
            errors,
          });
        }
      }
    }

    if (failures.length > 0) {
      const message = failures
        .map((f) =>
          [
            `Template ${f.templateKey} / table ${f.tableName} (${f.tableId}) / db ${f.dbTableName}`,
            formatSchemaErrors(f.errors),
          ].join('\n')
        )
        .join('\n\n');
      throw new Error(`SchemaChecker errors found:\n${message}`);
    }

    expect(failures).toHaveLength(0);
  }, 180_000);
});
