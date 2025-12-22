import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import type { NumberField } from '../domain/table/fields/types/NumberField';
import type { SingleSelectField } from '../domain/table/fields/types/SingleSelectField';
import { Table } from '../domain/table/Table';
import { CreateTableCommand } from './CreateTableCommand';

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`);

const buildFromCommand = (command: CreateTableCommand) => {
  const builder = Table.builder().withBaseId(command.baseId).withName(command.tableName);
  for (const fieldSpec of command.fields) fieldSpec.applyTo(builder);
  for (const viewSpec of command.views) viewSpec.applyTo(builder);
  return builder.build();
};

describe('CreateTableCommand', () => {
  it('creates command with default field and view', () => {
    const baseIdResult = createBaseId('a');
    expect(baseIdResult.isOk()).toBe(true);
    if (baseIdResult.isErr()) return;

    const commandResult = CreateTableCommand.create({
      baseId: baseIdResult.value.toString(),
      name: 'Default Table',
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const buildResult = buildFromCommand(commandResult.value);
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;

    const table = buildResult.value;
    expect(table.fields().length).toBe(1);
    expect(table.fields()[0]?.type().toString()).toBe('singleLineText');
    expect(table.fields()[0]?.name().toString()).toBe('Name');
    expect(table.views().length).toBe(1);
    expect(table.views()[0]?.type().toString()).toBe('grid');
    expect(table.views()[0]?.name().toString()).toBe('Grid');
  });

  it('creates command with all field types and view types', () => {
    const baseIdResult = createBaseId('b');
    expect(baseIdResult.isOk()).toBe(true);
    if (baseIdResult.isErr()) return;

    const commandResult = CreateTableCommand.create({
      baseId: baseIdResult.value.toString(),
      name: 'Complex Table',
      fields: [
        {
          type: 'singleLineText',
          name: 'Title',
          options: { showAs: { type: 'url' }, defaultValue: 'https://example.com' },
          isPrimary: true,
        },
        {
          type: 'longText',
          name: 'Notes',
          options: { defaultValue: 'note' },
        },
        {
          type: 'number',
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        {
          type: 'rating',
          name: 'Score',
          options: { max: 5, icon: 'star', color: 'redBright' },
        },
        {
          type: 'singleSelect',
          name: 'Status',
          options: ['Todo', 'Done'],
        },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt1', name: 'A', color: 'blue' },
              { id: 'opt2', name: 'B', color: 'red' },
            ],
            defaultValue: ['A'],
            preventAutoNewOptions: true,
          },
        },
        {
          type: 'checkbox',
          name: 'Done',
          options: { defaultValue: true },
        },
        {
          type: 'attachment',
          name: 'Files',
        },
        {
          type: 'date',
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        {
          type: 'user',
          name: 'Owner',
          options: { isMultiple: true, shouldNotify: true, defaultValue: ['usr123'] },
        },
        {
          type: 'button',
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 2,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
      ],
      views: [
        { type: 'grid', name: 'Main' },
        { type: 'kanban' },
        { type: 'calendar' },
        { type: 'gallery' },
        { type: 'form' },
        { type: 'plugin' },
      ],
    });
    expect(commandResult.isOk()).toBe(true);
    if (commandResult.isErr()) return;

    const buildResult = buildFromCommand(commandResult.value);
    expect(buildResult.isOk()).toBe(true);
    if (buildResult.isErr()) return;

    const table = buildResult.value;
    expect(table.fields().map((field) => field.type().toString())).toEqual([
      'singleLineText',
      'longText',
      'number',
      'rating',
      'singleSelect',
      'multipleSelect',
      'checkbox',
      'attachment',
      'date',
      'user',
      'button',
    ]);
    expect(table.views().map((view) => view.type().toString())).toEqual([
      'grid',
      'kanban',
      'calendar',
      'gallery',
      'form',
      'plugin',
    ]);

    const numberField = table.fields().find((field) => field.type().toString() === 'number') as
      | NumberField
      | undefined;
    expect(numberField?.formatting().type()).toBe('currency');
    expect(numberField?.showAs()).toBeDefined();

    const selectField = table
      .fields()
      .find((field) => field.type().toString() === 'singleSelect') as SingleSelectField | undefined;
    expect(selectField?.preventAutoNewOptions().toBoolean()).toBe(false);

    const firstView = table.views()[0];
    expect(firstView?.name().toString()).toBe('Main');
  });

  it('rejects invalid input and conflicting primary fields', () => {
    expect(CreateTableCommand.create({ baseId: 'bad', name: 'Table' }).isErr()).toBe(true);

    const baseIdResult = createBaseId('c');
    expect(baseIdResult.isOk()).toBe(true);
    if (baseIdResult.isErr()) return;

    const multiplePrimaryResult = CreateTableCommand.create({
      baseId: baseIdResult.value.toString(),
      name: 'Primary',
      fields: [
        { type: 'singleLineText', name: 'A', isPrimary: true },
        { type: 'singleLineText', name: 'B', isPrimary: true },
      ],
      views: [{ type: 'grid' }],
    });
    expect(multiplePrimaryResult.isErr()).toBe(true);
    if (multiplePrimaryResult.isErr()) {
      expect(multiplePrimaryResult.error).toContain('primary Field');
    }

    const badFieldNameResult = CreateTableCommand.create({
      baseId: baseIdResult.value.toString(),
      name: 'Bad Name',
      fields: [{ type: 'singleLineText', name: '', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    expect(badFieldNameResult.isErr()).toBe(true);

    const badSelectResult = CreateTableCommand.create({
      baseId: baseIdResult.value.toString(),
      name: 'Bad Select',
      fields: [
        {
          type: 'singleSelect',
          name: 'Status',
          options: { choices: [{ name: '', color: 'blue' }] },
        },
      ],
      views: [{ type: 'grid' }],
    });
    expect(badSelectResult.isErr()).toBe(true);
  });
});
