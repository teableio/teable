import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo } from '@teable/core';
import {
  buttonFieldOptionsSchema,
  Colors,
  DateFormattingPreset,
  FieldAIActionType,
  FieldType,
  generateWorkflowId,
  NumberFormattingType,
  RatingIcon,
  Relationship,
  SingleNumberDisplayType,
  SingleLineTextDisplayType,
  TimeFormatting,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { deleteField, ensureUndoRedoWindowIdHeader, getFields, redo, undo } from '@teable/openapi';
import {
  convertField,
  createField,
  createFields,
  createTable,
  getField,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

const withForceV2All = async <T>(callback: () => Promise<T>) => {
  const previousForceV2All = process.env.FORCE_V2_ALL;
  process.env.FORCE_V2_ALL = 'true';
  try {
    return await callback();
  } finally {
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  }
};

const choiceNames = (field: IFieldVo) => {
  const options = field.options;
  if (!options || typeof options !== 'object' || !('choices' in options)) return [];
  const { choices } = options;
  if (!Array.isArray(choices)) return [];
  return choices
    .filter((choice): choice is { name: string } => {
      return (
        typeof choice === 'object' &&
        choice != null &&
        'name' in choice &&
        typeof choice.name === 'string'
      );
    })
    .map((choice) => choice.name)
    .sort((a, b) => Number(a > b) - Number(a < b));
};
type OptionCase = {
  name: string;
  create: IFieldRo;
  expected: Record<string, unknown>;
  expectedChoices?: string[];
  requiresOptionsOnConvert?: boolean;
};

const optionCases: OptionCase[] = [
  {
    name: 'longText markdown',
    create: {
      name: 'Notes',
      type: FieldType.LongText,
      options: { showAs: { type: 'markdown' } },
    },
    expected: { showAs: { type: 'markdown' } },
  },
  {
    name: 'singleLineText url',
    create: {
      name: 'Website',
      type: FieldType.SingleLineText,
      options: { showAs: { type: SingleLineTextDisplayType.Url } },
    },
    expected: { showAs: { type: SingleLineTextDisplayType.Url } },
  },
  {
    name: 'number formatting',
    create: {
      name: 'Amount',
      type: FieldType.Number,
      options: {
        formatting: { type: NumberFormattingType.Currency, precision: 2, symbol: '$' },
      },
    },
    expected: {
      formatting: { type: NumberFormattingType.Currency, precision: 2, symbol: '$' },
    },
  },
  {
    name: 'singleSelect choices',
    create: {
      name: 'Status',
      type: FieldType.SingleSelect,
      options: {
        choices: [
          { name: 'Todo', color: Colors.Blue },
          { name: 'Done', color: Colors.Green },
        ],
      },
    },
    expected: {},
    expectedChoices: ['Done', 'Todo'],
  },
  {
    name: 'multipleSelect choices',
    create: {
      name: 'Tags',
      type: FieldType.MultipleSelect,
      options: {
        choices: [
          { name: 'Frontend', color: Colors.Purple },
          { name: 'Backend', color: Colors.Orange },
        ],
      },
    },
    expected: {},
    expectedChoices: ['Backend', 'Frontend'],
  },
  {
    name: 'rating',
    create: {
      name: 'Score',
      type: FieldType.Rating,
      options: { max: 5, icon: RatingIcon.Star, color: Colors.YellowBright },
    },
    expected: { max: 5, icon: RatingIcon.Star, color: Colors.YellowBright },
  },
  {
    name: 'date formatting',
    create: {
      name: 'Due',
      type: FieldType.Date,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.Hour24,
          timeZone: 'Asia/Shanghai',
        },
      },
    },
    expected: {
      formatting: {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Shanghai',
      },
    },
  },
  {
    name: 'user notify',
    create: {
      name: 'Owner',
      type: FieldType.User,
      options: { isMultiple: false, shouldNotify: false },
    },
    expected: { isMultiple: false, shouldNotify: false },
  },
  {
    name: 'checkbox default',
    create: {
      name: 'Done',
      type: FieldType.Checkbox,
      options: { defaultValue: true },
    },
    expected: { defaultValue: true },
  },
  {
    name: 'button label',
    create: {
      name: 'Action',
      type: FieldType.Button,
      options: { label: 'Run', color: Colors.Teal, maxCount: 3 },
    },
    expected: { label: 'Run', color: Colors.Teal, maxCount: 3 },
  },
  {
    name: 'createdTime formatting',
    create: {
      name: 'Created',
      type: FieldType.CreatedTime,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.Hour24,
          timeZone: 'Asia/Shanghai',
        },
      },
    },
    expected: {
      formatting: {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Shanghai',
      },
    },
  },
  {
    name: 'lastModifiedTime formatting',
    create: {
      name: 'Modified',
      type: FieldType.LastModifiedTime,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.None,
          timeZone: 'utc',
        },
      },
    },
    expected: {
      formatting: {
        date: DateFormattingPreset.ISO,
        time: TimeFormatting.None,
        timeZone: 'UTC',
      },
    },
  },
  {
    name: 'formula formatting',
    create: {
      name: 'Calc',
      type: FieldType.Formula,
      options: {
        expression: '1 + 1',
        formatting: { type: NumberFormattingType.Decimal, precision: 1 },
      },
    },
    expected: {
      expression: '1 + 1',
      formatting: { type: NumberFormattingType.Decimal, precision: 1 },
    },
    requiresOptionsOnConvert: true,
  },
  {
    name: 'singleSelect preventAutoNewOptions',
    create: {
      name: 'Locked Status',
      type: FieldType.SingleSelect,
      options: {
        choices: [
          { name: 'Open', color: Colors.Blue },
          { name: 'Closed', color: Colors.Red },
        ],
        preventAutoNewOptions: true,
      },
    },
    expected: { preventAutoNewOptions: true },
    expectedChoices: ['Closed', 'Open'],
  },
  {
    name: 'number showAs',
    create: {
      name: 'Progress',
      type: FieldType.Number,
      options: {
        formatting: { type: NumberFormattingType.Decimal, precision: 0 },
        showAs: {
          type: 'bar',
          color: Colors.Green,
          showValue: true,
          maxValue: 100,
        },
      },
    },
    expected: {
      formatting: { type: NumberFormattingType.Decimal, precision: 0 },
      showAs: {
        type: 'bar',
        color: Colors.Green,
        showValue: true,
        maxValue: 100,
      },
    },
  },
];

const expectOptionsPreserved = (field: IFieldVo, fieldCase: OptionCase) => {
  expect(field.options).toMatchObject(fieldCase.expected);
  if (fieldCase.expectedChoices) {
    expect(choiceNames(field)).toEqual(fieldCase.expectedChoices);
  }
};

describe('OpenAPI field option preservation (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    table = await createTable(baseId, { name: 'option-preservation-matrix' });
  });

  afterAll(async () => {
    if (table) {
      await permanentDeleteTable(baseId, table.id);
    }
    await app.close();
  });

  it.each(optionCases)(
    'keeps $name through GET, name-only convert, and resubmitted options (T6956)',
    async (fieldCase) => {
      await withForceV2All(async () => {
        const created = await createField(table.id, fieldCase.create);
        expectOptionsPreserved(created, fieldCase);

        const afterCreate = await getField(table.id, created.id);
        expectOptionsPreserved(afterCreate, fieldCase);

        const afterNameOnly = await convertField(table.id, created.id, {
          name: `${fieldCase.create.name} renamed`,
          type: fieldCase.create.type,
          ...(fieldCase.requiresOptionsOnConvert ? { options: afterCreate.options } : {}),
        });
        expect(afterNameOnly.name).toBe(`${fieldCase.create.name} renamed`);
        expectOptionsPreserved(afterNameOnly, fieldCase);
        expectOptionsPreserved(await getField(table.id, created.id), fieldCase);

        const afterResubmit = await convertField(table.id, created.id, {
          name: `${fieldCase.create.name} resubmitted`,
          type: fieldCase.create.type,
          options: afterCreate.options,
        });
        expectOptionsPreserved(afterResubmit, fieldCase);
        expectOptionsPreserved(await getField(table.id, created.id), fieldCase);
      });
    }
  );

  it('rejects invalid button click limits and clears disabled limits (T7768 T7769)', async () => {
    await withForceV2All(async () => {
      const options = { label: 'Run', color: Colors.Teal, maxCount: 3, resetCount: true };
      const created = await createField(table.id, {
        name: 'Button limit',
        type: FieldType.Button,
        options,
      });

      for (const maxCount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await convertField(
          table.id,
          created.id,
          { type: FieldType.Button, options: { ...options, maxCount } },
          400
        );
        expect((await getField(table.id, created.id)).options).toMatchObject(options);
      }

      await convertField(table.id, created.id, {
        type: FieldType.Button,
        options: { ...options, maxCount: null, resetCount: false },
      });
      const disabled = (await getField(table.id, created.id)).options;
      expect(disabled).not.toHaveProperty('maxCount');
      expect(disabled).toMatchObject({ resetCount: false });

      for (const maxCount of [1, 5, 10, Number.MAX_SAFE_INTEGER]) {
        await convertField(table.id, created.id, {
          type: FieldType.Button,
          options: { ...options, maxCount, resetCount: false },
        });
        expect((await getField(table.id, created.id)).options).toMatchObject({
          maxCount,
          resetCount: false,
        });
      }
    });
  });

  it('loads and repairs legacy button limits without losing other options (T7768 T7769)', async () => {
    await withForceV2All(async () => {
      const preserved = {
        label: 'Legacy action',
        color: Colors.Red,
        resetCount: true,
        workflow: { id: generateWorkflowId(), name: 'Legacy workflow', isActive: false },
        confirm: { title: 'Confirm action', description: 'Keep this', confirmText: 'Run' },
      };
      const created = await createField(table.id, {
        name: 'Legacy button',
        type: FieldType.Button,
        options: { ...preserved, maxCount: 3 },
      });
      for (const maxCount of [0, -1, 1.5]) {
        const legacy = { ...preserved, maxCount };
        await app.get(PrismaService).field.update({
          where: { id: created.id },
          data: { options: JSON.stringify(legacy) },
        });
        const loaded = await getField(table.id, created.id);
        expect(buttonFieldOptionsSchema.parse(loaded.options)).toEqual(legacy);
        ensureUndoRedoWindowIdHeader(`win-button-repair-${maxCount}-${Date.now()}`);
        await convertField(table.id, created.id, {
          type: FieldType.Button,
          name: created.name,
          options: { ...legacy, maxCount: 1 },
        });
        expect((await getField(table.id, created.id)).options).toEqual({
          ...preserved,
          maxCount: 1,
        });
        expect((await undo(table.id)).data.status).toBe('fulfilled');
        expect((await getField(table.id, created.id)).options).toEqual(legacy);
        expect((await redo(table.id)).data.status).toBe('fulfilled');
        expect((await getField(table.id, created.id)).options).toEqual({
          ...preserved,
          maxCount: 1,
        });
        expect((await undo(table.id)).data.status).toBe('fulfilled');
        await deleteField(table.id, created.id);
        expect((await undo(table.id)).data.status).toBe('fulfilled');
        expect((await getField(table.id, created.id)).options).toEqual(legacy);
      }
      const unlimited = await createField(table.id, {
        name: 'New unlimited button',
        type: FieldType.Button,
        options: { label: 'Run', color: Colors.Teal, maxCount: null, resetCount: false },
      });
      expect(unlimited.options).not.toHaveProperty('maxCount');
      expect(unlimited.options).toMatchObject({ resetCount: false });
    });
  });

  it('rejects invalid button limits in a batch before adding any field (T7769)', async () => {
    const before = (await getFields(table.id)).data;
    for (const maxCount of [0, -1, 1.5]) {
      await expect(
        createFields(
          table.id,
          [
            { name: 'Valid batch field', type: FieldType.SingleLineText },
            {
              name: 'Invalid batch button',
              type: FieldType.Button,
              options: { label: 'Run', color: Colors.Teal, maxCount },
            },
          ],
          app
        )
      ).rejects.toThrow();
      expect((await getFields(table.id)).data).toEqual(before);
    }
  });

  it('keeps longText markdown when convert sends empty options (T6956)', async () => {
    await withForceV2All(async () => {
      const created = await createField(table.id, {
        name: 'Notes',
        type: FieldType.LongText,
        options: { showAs: { type: 'markdown' } },
      });

      const converted = await convertField(table.id, created.id, {
        name: 'Notes emptied',
        type: FieldType.LongText,
        options: {},
      });

      expect(converted.options).toMatchObject({ showAs: { type: 'markdown' } });
      expect((await getField(table.id, created.id)).options).toMatchObject({
        showAs: { type: 'markdown' },
      });
    });
  });

  it('keeps longText markdown when the editor only changes AI config (T6956)', async () => {
    await withForceV2All(async () => {
      const created = await createField(table.id, {
        name: 'Changelog',
        type: FieldType.LongText,
        options: { showAs: { type: 'markdown' } },
        aiConfig: {
          type: FieldAIActionType.Customization,
          modelKey: 'old-model',
          prompt: 'Rewrite this changelog.',
        },
      });
      expect(created.options).toMatchObject({ showAs: { type: 'markdown' } });

      const converted = await convertField(table.id, created.id, {
        name: created.name,
        type: FieldType.LongText,
        options: created.options,
        aiConfig: {
          type: FieldAIActionType.Customization,
          modelKey: 'new-model',
          prompt: 'Rewrite this changelog.',
        },
      });

      expect(converted.aiConfig).toMatchObject({ modelKey: 'new-model' });
      expect(converted.options).toMatchObject({ showAs: { type: 'markdown' } });
      expect((await getField(table.id, created.id)).options).toMatchObject({
        showAs: { type: 'markdown' },
      });
    });
  });

  it('keeps lastModifiedBy trackedFieldIds through name-only convert (T6956)', async () => {
    await withForceV2All(async () => {
      const tracked = table.fields[0];
      const created = await createField(table.id, {
        name: 'Editor',
        type: FieldType.LastModifiedBy,
        options: { trackedFieldIds: [tracked.id] },
      });
      expect(created.options).toMatchObject({ trackedFieldIds: [tracked.id] });

      const converted = await convertField(table.id, created.id, {
        name: 'Editor renamed',
        type: FieldType.LastModifiedBy,
      });
      expect(converted.options).toMatchObject({ trackedFieldIds: [tracked.id] });
      expect((await getField(table.id, created.id)).options).toMatchObject({
        trackedFieldIds: [tracked.id],
      });
    });
  });

  it('keeps link relationship and one-way through name convert (T6956)', async () => {
    await withForceV2All(async () => {
      const foreign = await createTable(baseId, { name: 'option-preservation-foreign' });
      try {
        const created = await createField(table.id, {
          name: 'Related',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: foreign.id,
            isOneWay: true,
          },
        });
        expect(created.options).toMatchObject({
          relationship: Relationship.ManyOne,
          foreignTableId: foreign.id,
          isOneWay: true,
        });

        const converted = await convertField(table.id, created.id, {
          name: 'Related renamed',
          type: FieldType.Link,
          options: created.options,
        });
        expect(converted.options).toMatchObject({
          relationship: Relationship.ManyOne,
          foreignTableId: foreign.id,
          isOneWay: true,
        });
      } finally {
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });

  it('drops incompatible inherited ring only for multiple lookups (T7745)', async () => {
    await withForceV2All(async () => {
      const formatting = {
        type: NumberFormattingType.Currency,
        precision: 1,
        symbol: '¥',
      } as const;
      const showAs = {
        type: SingleNumberDisplayType.Ring,
        color: Colors.Blue,
        showValue: true,
        maxValue: 100,
      } as const;
      const foreign = await createTable(baseId, {
        name: 'lookup-display-source',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number, options: { formatting, showAs } },
        ],
      });
      try {
        const amount = foreign.fields.find((field) => field.name === 'Amount');
        if (!amount) throw new Error('Amount field missing');
        for (const relationship of [Relationship.ManyOne, Relationship.ManyMany]) {
          const link = await createField(table.id, {
            name: `Related ${relationship}`,
            type: FieldType.Link,
            options: { relationship, foreignTableId: foreign.id },
          });
          const created = await createField(table.id, {
            name: `Amount ${relationship}`,
            type: FieldType.Number,
            isLookup: true,
            lookupOptions: {
              foreignTableId: foreign.id,
              lookupFieldId: amount.id,
              linkFieldId: link.id,
            },
          });
          const stored = await getField(table.id, created.id);
          for (const field of [created, stored]) {
            expect(field.isMultipleCellValue === true).toBe(relationship === Relationship.ManyMany);
            expect(field.options).toEqual(
              relationship === Relationship.ManyMany ? { formatting } : { formatting, showAs }
            );
          }
          const persisted = await app.get(PrismaService).field.findUniqueOrThrow({
            where: { id: created.id },
            select: { options: true },
          });
          expect(JSON.parse(persisted.options ?? 'null')).toEqual(
            relationship === Relationship.ManyMany ? { formatting } : { formatting, showAs }
          );
        }
        expect((await getField(foreign.id, amount.id)).options).toEqual({ formatting, showAs });
      } finally {
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });

  it('inherits a compatible source display added after lookup creation (T7745)', async () => {
    await withForceV2All(async () => {
      const foreign = await createTable(baseId, {
        name: 'lookup-late-display-source',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
        ],
      });
      try {
        const amount = foreign.fields.find((field) => field.name === 'Amount');
        if (!amount) throw new Error('Amount field missing');
        const link = await createField(table.id, {
          name: 'Related without display',
          type: FieldType.Link,
          options: { relationship: Relationship.ManyOne, foreignTableId: foreign.id },
        });
        const lookup = await createField(table.id, {
          name: 'Amount without display',
          type: FieldType.Number,
          isLookup: true,
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: amount.id,
            linkFieldId: link.id,
          },
        });
        expect(lookup.options).not.toHaveProperty('showAs');
        const showAs = {
          type: SingleNumberDisplayType.Ring,
          color: Colors.Blue,
          showValue: true,
          maxValue: 100,
        } as const;
        await convertField(foreign.id, amount.id, {
          type: FieldType.Number,
          options: { ...amount.options, showAs },
        });
        const stored = await getField(table.id, lookup.id);
        expect(stored.isMultipleCellValue).not.toBe(true);
        expect(stored.options).toMatchObject({ showAs });
      } finally {
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });

  it('keeps rollup expression through name convert (T6956)', async () => {
    await withForceV2All(async () => {
      const foreign = await createTable(baseId, {
        name: 'option-preservation-rollup-src',
        fields: [
          { name: 'Title', type: FieldType.SingleLineText },
          { name: 'Amount', type: FieldType.Number },
        ],
      });
      try {
        const amount = foreign.fields.find((field) => field.name === 'Amount');
        if (!amount) throw new Error('Amount field missing');
        const link = await createField(table.id, {
          name: 'Orders',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyMany,
            foreignTableId: foreign.id,
            isOneWay: true,
          },
        });
        const created = await createField(table.id, {
          name: 'Order Total',
          type: FieldType.Rollup,
          options: {
            expression: 'sum({values})',
            formatting: { type: NumberFormattingType.Decimal, precision: 2 },
          },
          lookupOptions: {
            foreignTableId: foreign.id,
            lookupFieldId: amount.id,
            linkFieldId: link.id,
          },
        });
        expect(created.options).toMatchObject({
          expression: 'sum({values})',
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        });

        const converted = await convertField(table.id, created.id, {
          name: 'Order Total renamed',
          type: FieldType.Rollup,
          options: created.options,
          lookupOptions: created.lookupOptions,
        });
        expect(converted.options).toMatchObject({
          expression: 'sum({values})',
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        });
      } finally {
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });
});
