import { describe, expect, it } from 'vitest';

import { MetaValidationVisitor } from './MetaValidationVisitor';

const asId = (value: string) => ({
  toString: () => value,
});

const createField = (params: {
  id: string;
  name: string;
  type: string;
  foreignTableId?: string;
  lookupFieldId?: string;
  linkFieldId?: string;
  isOneWay?: boolean;
  symmetricFieldId?: string;
}) => ({
  id: () => asId(params.id),
  name: () => asId(params.name),
  type: () => asId(params.type),
  ...(params.foreignTableId
    ? {
        foreignTableId: () => asId(params.foreignTableId),
      }
    : {}),
  ...(params.lookupFieldId
    ? {
        lookupFieldId: () => asId(params.lookupFieldId),
      }
    : {}),
  ...(params.linkFieldId
    ? {
        linkFieldId: () => asId(params.linkFieldId),
      }
    : {}),
  ...(params.isOneWay !== undefined
    ? {
        isOneWay: () => params.isOneWay,
      }
    : {}),
  ...(params.symmetricFieldId
    ? {
        symmetricFieldId: () => asId(params.symmetricFieldId),
      }
    : {
        symmetricFieldId: () => undefined,
      }),
});

const createSelectField = (params: {
  id: string;
  name: string;
  type: 'singleSelect' | 'multipleSelect';
  optionIds: string[];
}) => ({
  id: () => asId(params.id),
  name: () => asId(params.name),
  type: () => asId(params.type),
  selectOptions: () =>
    params.optionIds.map((optionId, index) => ({
      id: () => asId(optionId),
      name: () => asId(`Option ${index + 1}`),
    })),
});

const createFormulaField = (params: { id: string; name: string; dependencyIds: string[] }) => ({
  id: () => asId(params.id),
  name: () => asId(params.name),
  type: () => asId('formula'),
  dependencies: () => params.dependencyIds.map((dependencyId) => asId(dependencyId)),
});

const createContext = (params?: {
  tableId?: string;
  tables?: Record<string, { id: () => { toString(): string }; name: () => { toString(): string } }>;
  fields?: Record<string, ReturnType<typeof createField>>;
}) => ({
  table: {
    id: () => asId(params?.tableId ?? `tbl${'a'.repeat(16)}`),
  },
  getTable: (tableId: string) => params?.tables?.[tableId],
  getField: (tableId: string, fieldId: string) => params?.fields?.[`${tableId}:${fieldId}`],
});

describe('MetaValidationVisitor', () => {
  it('reports missing foreign tables for link fields', () => {
    const visitor = new MetaValidationVisitor(createContext() as never);
    const field = createField({
      id: 'fld1',
      name: 'Assignee',
      type: 'link',
      foreignTableId: 'tbl_missing',
      lookupFieldId: 'fld_lookup',
      isOneWay: true,
    });

    const result = visitor.visitLinkField(field as never);

    expect(result._unsafeUnwrap()).toEqual([
      expect.objectContaining({
        category: 'reference',
        severity: 'error',
        message: 'Foreign table not found: tbl_missing',
      }),
    ]);
  });

  it('validates one-way links and successful lookup references', () => {
    const foreignTableId = `tbl${'b'.repeat(16)}`;
    const lookupFieldId = `fld${'c'.repeat(16)}`;
    const visitor = new MetaValidationVisitor(
      createContext({
        tables: {
          [foreignTableId]: {
            id: () => asId(foreignTableId),
            name: () => asId('Users'),
          },
        },
        fields: {
          [`${foreignTableId}:${lookupFieldId}`]: createField({
            id: lookupFieldId,
            name: 'User Name',
            type: 'singleLineText',
          }),
        },
      }) as never
    );
    const field = createField({
      id: `fld${'d'.repeat(16)}`,
      name: 'User',
      type: 'link',
      foreignTableId,
      lookupFieldId,
      isOneWay: true,
    });

    const result = visitor.visitLinkField(field as never);

    expect(result._unsafeUnwrap().map((issue) => issue.message)).toEqual([
      '✓ Foreign table exists: Users',
      '✓ Lookup field exists: User Name',
      '✓ One-way link (no symmetric field required)',
    ]);
  });

  it('reports two-way link schema issues and lookup reference mismatches', () => {
    const currentTableId = `tbl${'e'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const linkFieldId = `fld${'1'.repeat(16)}`;
    const visitor = new MetaValidationVisitor(
      createContext({
        tableId: currentTableId,
        tables: {
          [foreignTableId]: {
            id: () => asId(foreignTableId),
            name: () => asId('Tasks'),
          },
        },
        fields: {
          [`${currentTableId}:${linkFieldId}`]: createField({
            id: linkFieldId,
            name: 'Project Link',
            type: 'link',
            foreignTableId: `tbl${'9'.repeat(16)}`,
            lookupFieldId: `fld${'2'.repeat(16)}`,
            isOneWay: true,
          }),
        },
      }) as never
    );

    const twoWayLink = createField({
      id: `fld${'3'.repeat(16)}`,
      name: 'Relation',
      type: 'link',
      foreignTableId,
      lookupFieldId: `fld${'4'.repeat(16)}`,
      isOneWay: false,
    });
    const lookupField = createField({
      id: `fld${'5'.repeat(16)}`,
      name: 'Lookup',
      type: 'lookup',
      foreignTableId,
      linkFieldId,
      lookupFieldId: `fld${'6'.repeat(16)}`,
    });

    const linkIssues = visitor.visitLinkField(twoWayLink as never)._unsafeUnwrap();
    const lookupIssues = visitor.visitLookupField(lookupField as never)._unsafeUnwrap();

    expect(linkIssues).toEqual([
      expect.objectContaining({ message: '✓ Foreign table exists: Tasks' }),
      expect.objectContaining({
        message: `Lookup field not found in foreign table: fld${'4'.repeat(16)}`,
      }),
      expect.objectContaining({
        category: 'schema',
        message: 'Two-way link field is missing symmetricFieldId',
      }),
    ]);
    expect(lookupIssues).toEqual([
      expect.objectContaining({ message: '✓ Link field exists: Project Link' }),
      expect.objectContaining({
        message: `Foreign table ID mismatch: lookup has ${foreignTableId}, link field has tbl${'9'.repeat(16)}`,
      }),
      expect.objectContaining({
        message: `Lookup source field not found in foreign table: fld${'6'.repeat(16)}`,
      }),
    ]);
  });

  it('treats simple field types as schema-valid by default', () => {
    const visitor = new MetaValidationVisitor(createContext() as never);
    const field = createField({
      id: `fld${'7'.repeat(16)}`,
      name: 'Title',
      type: 'singleLineText',
    });

    const result = visitor.visitSingleLineTextField(field as never);

    expect(result._unsafeUnwrap()).toEqual([
      expect.objectContaining({
        category: 'schema',
        severity: 'info',
        message: '✓ Field configuration is valid',
      }),
    ]);
  });

  it('validates fully consistent two-way links', () => {
    const currentTableId = `tbl${'1'.repeat(16)}`;
    const foreignTableId = `tbl${'2'.repeat(16)}`;
    const symmetricFieldId = `fld${'3'.repeat(16)}`;
    const fieldId = `fld${'4'.repeat(16)}`;
    const lookupFieldId = `fld${'5'.repeat(16)}`;
    const visitor = new MetaValidationVisitor(
      createContext({
        tableId: currentTableId,
        tables: {
          [foreignTableId]: {
            id: () => asId(foreignTableId),
            name: () => asId('Related Table'),
          },
        },
        fields: {
          [`${foreignTableId}:${lookupFieldId}`]: createField({
            id: lookupFieldId,
            name: 'Primary',
            type: 'singleLineText',
          }),
          [`${foreignTableId}:${symmetricFieldId}`]: createField({
            id: symmetricFieldId,
            name: 'Back Link',
            type: 'link',
            foreignTableId: currentTableId,
            lookupFieldId: fieldId,
            isOneWay: false,
            symmetricFieldId: fieldId,
          }),
        },
      }) as never
    );
    const field = createField({
      id: fieldId,
      name: 'Forward Link',
      type: 'link',
      foreignTableId,
      lookupFieldId,
      isOneWay: false,
      symmetricFieldId,
    });

    const issues = visitor.visitLinkField(field as never)._unsafeUnwrap();

    expect(issues.map((issue) => issue.message)).toEqual([
      '✓ Foreign table exists: Related Table',
      '✓ Lookup field exists: Primary',
      '✓ Symmetric field exists: Back Link',
      '✓ Symmetric field points back to current table',
      '✓ Bidirectional symmetry is consistent',
    ]);
  });

  it('reports invalid symmetric link type and back-reference mismatches', () => {
    const currentTableId = `tbl${'6'.repeat(16)}`;
    const foreignTableId = `tbl${'7'.repeat(16)}`;
    const symmetricFieldId = `fld${'8'.repeat(16)}`;
    const fieldId = `fld${'9'.repeat(16)}`;
    const visitorWithWrongType = new MetaValidationVisitor(
      createContext({
        tableId: currentTableId,
        tables: {
          [foreignTableId]: {
            id: () => asId(foreignTableId),
            name: () => asId('Foreign'),
          },
        },
        fields: {
          [`${foreignTableId}:${`fld${'a'.repeat(16)}`}`]: createField({
            id: `fld${'a'.repeat(16)}`,
            name: 'Name',
            type: 'singleLineText',
          }),
          [`${foreignTableId}:${symmetricFieldId}`]: createField({
            id: symmetricFieldId,
            name: 'Not A Link',
            type: 'number',
          }),
        },
      }) as never
    );
    const visitorWithMismatchedBackrefs = new MetaValidationVisitor(
      createContext({
        tableId: currentTableId,
        tables: {
          [foreignTableId]: {
            id: () => asId(foreignTableId),
            name: () => asId('Foreign'),
          },
        },
        fields: {
          [`${foreignTableId}:${`fld${'a'.repeat(16)}`}`]: createField({
            id: `fld${'a'.repeat(16)}`,
            name: 'Name',
            type: 'singleLineText',
          }),
          [`${foreignTableId}:${symmetricFieldId}`]: createField({
            id: symmetricFieldId,
            name: 'Back Link',
            type: 'link',
            foreignTableId: `tbl${'b'.repeat(16)}`,
            lookupFieldId: fieldId,
            isOneWay: false,
            symmetricFieldId: `fld${'c'.repeat(16)}`,
          }),
        },
      }) as never
    );
    const field = createField({
      id: fieldId,
      name: 'Relation',
      type: 'link',
      foreignTableId,
      lookupFieldId: `fld${'a'.repeat(16)}`,
      isOneWay: false,
      symmetricFieldId,
    });

    const wrongTypeIssues = visitorWithWrongType.visitLinkField(field as never)._unsafeUnwrap();
    const mismatchIssues = visitorWithMismatchedBackrefs
      .visitLinkField(field as never)
      ._unsafeUnwrap();

    expect(
      wrongTypeIssues.some((issue) => issue.message.includes('Symmetric field is not a link field'))
    ).toBe(true);
    expect(
      mismatchIssues.some((issue) => issue.message.includes('does not point back to current table'))
    ).toBe(true);
    expect(
      mismatchIssues.some((issue) => issue.message.includes('does not point back to this field'))
    ).toBe(true);
  });

  it('validates formula dependencies across no-dependency, partial, and complete cases', () => {
    const currentTableId = `tbl${'d'.repeat(16)}`;
    const visitor = new MetaValidationVisitor(
      createContext({
        tableId: currentTableId,
        fields: {
          [`${currentTableId}:fld_existing_000001`]: createField({
            id: 'fld_existing_000001',
            name: 'Existing 1',
            type: 'singleLineText',
          }),
          [`${currentTableId}:fld_existing_000002`]: createField({
            id: 'fld_existing_000002',
            name: 'Existing 2',
            type: 'number',
          }),
        },
      }) as never
    );

    const noDeps = visitor
      .visitFormulaField(
        createFormulaField({
          id: 'fld_formula_000001',
          name: 'No Deps',
          dependencyIds: [],
        }) as never
      )
      ._unsafeUnwrap();
    const partial = visitor
      .visitFormulaField(
        createFormulaField({
          id: 'fld_formula_000002',
          name: 'Partial',
          dependencyIds: ['fld_existing_000001', 'fld_missing_000001'],
        }) as never
      )
      ._unsafeUnwrap();
    const allFound = visitor
      .visitFormulaField(
        createFormulaField({
          id: 'fld_formula_000003',
          name: 'All Found',
          dependencyIds: ['fld_existing_000001', 'fld_existing_000002'],
        }) as never
      )
      ._unsafeUnwrap();

    expect(noDeps).toEqual([
      expect.objectContaining({ message: '✓ Formula has no field dependencies' }),
    ]);
    expect(
      partial.some((issue) => issue.message.includes('Formula references non-existent field'))
    ).toBe(true);
    expect(partial.some((issue) => issue.message === '✓ 1 of 2 dependency fields exist')).toBe(
      true
    );
    expect(allFound).toEqual([
      expect.objectContaining({ message: '✓ All 2 dependency fields exist' }),
    ]);
  });

  it('validates select option id uniqueness for single and multiple select fields', () => {
    const visitor = new MetaValidationVisitor(createContext() as never);

    const uniqueSingleSelect = visitor
      .visitSingleSelectField(
        createSelectField({
          id: 'fld_select_000001',
          name: 'Priority',
          type: 'singleSelect',
          optionIds: ['opt1', 'opt2'],
        }) as never
      )
      ._unsafeUnwrap();
    const duplicateMultiSelect = visitor
      .visitMultipleSelectField(
        createSelectField({
          id: 'fld_select_000002',
          name: 'Tags',
          type: 'multipleSelect',
          optionIds: ['dup', 'dup', 'uniq'],
        }) as never
      )
      ._unsafeUnwrap();

    expect(uniqueSingleSelect).toEqual([
      expect.objectContaining({
        message: '✓ All 2 choice IDs are unique',
        details: { path: 'options.choices' },
      }),
    ]);
    expect(duplicateMultiSelect).toEqual([
      expect.objectContaining({
        category: 'schema',
        message: 'Duplicate choice IDs found: dup',
      }),
    ]);
  });

  it('validates rollup and conditional field references', () => {
    const currentTableId = `tbl${'e'.repeat(16)}`;
    const foreignTableId = `tbl${'f'.repeat(16)}`;
    const linkFieldId = `fld${'1'.repeat(16)}`;
    const lookupFieldId = `fld${'2'.repeat(16)}`;
    const visitor = new MetaValidationVisitor(
      createContext({
        tableId: currentTableId,
        tables: {
          [foreignTableId]: {
            id: () => asId(foreignTableId),
            name: () => asId('People'),
          },
        },
        fields: {
          [`${currentTableId}:${linkFieldId}`]: createField({
            id: linkFieldId,
            name: 'Owner',
            type: 'link',
            foreignTableId,
            lookupFieldId,
            isOneWay: true,
          }),
          [`${foreignTableId}:${lookupFieldId}`]: createField({
            id: lookupFieldId,
            name: 'Name',
            type: 'singleLineText',
          }),
        },
      }) as never
    );
    const missingLinkRollup = visitor
      .visitRollupField(
        createField({
          id: 'fld_rollup_missing',
          name: 'Missing Link Rollup',
          type: 'rollup',
          foreignTableId,
          linkFieldId: 'fld_missing',
          lookupFieldId,
        }) as never
      )
      ._unsafeUnwrap();
    const validRollup = visitor
      .visitRollupField(
        createField({
          id: 'fld_rollup_ok',
          name: 'Valid Rollup',
          type: 'rollup',
          foreignTableId,
          linkFieldId,
          lookupFieldId,
        }) as never
      )
      ._unsafeUnwrap();
    const conditionalMissingForeign = visitor
      .visitConditionalLookupField(
        createField({
          id: 'fld_cond_missing',
          name: 'Conditional Missing',
          type: 'conditionalLookup',
          foreignTableId: 'tbl_missing',
          lookupFieldId,
        }) as never
      )
      ._unsafeUnwrap();
    const conditionalOk = visitor
      .visitConditionalRollupField(
        createField({
          id: 'fld_cond_ok',
          name: 'Conditional Rollup',
          type: 'conditionalRollup',
          foreignTableId,
          lookupFieldId,
        }) as never
      )
      ._unsafeUnwrap();

    expect(missingLinkRollup).toEqual([
      expect.objectContaining({ message: 'Link field not found: fld_missing' }),
    ]);
    expect(validRollup.map((issue) => issue.message)).toEqual([
      '✓ Link field exists: Owner',
      '✓ Foreign table ID matches link field',
      '✓ Rollup source field exists: Name',
    ]);
    expect(conditionalMissingForeign).toEqual([
      expect.objectContaining({ message: 'Foreign table not found: tbl_missing' }),
    ]);
    expect(conditionalOk.map((issue) => issue.message)).toEqual([
      '✓ Foreign table exists: People',
      '✓ Lookup field exists: Name',
    ]);
  });

  it('returns schema-valid results for the remaining simple field types', () => {
    const visitor = new MetaValidationVisitor(createContext() as never);
    const methods = [
      ['visitLongTextField', createField({ id: 'fld_lt', name: 'Long', type: 'longText' })],
      ['visitNumberField', createField({ id: 'fld_num', name: 'Num', type: 'number' })],
      ['visitRatingField', createField({ id: 'fld_rate', name: 'Rate', type: 'rating' })],
      ['visitCheckboxField', createField({ id: 'fld_chk', name: 'Check', type: 'checkbox' })],
      ['visitAttachmentField', createField({ id: 'fld_att', name: 'Attach', type: 'attachment' })],
      ['visitDateField', createField({ id: 'fld_date', name: 'Date', type: 'date' })],
      ['visitCreatedTimeField', createField({ id: 'fld_ct', name: 'CT', type: 'createdTime' })],
      [
        'visitLastModifiedTimeField',
        createField({ id: 'fld_lmt', name: 'LMT', type: 'lastModifiedTime' }),
      ],
      ['visitUserField', createField({ id: 'fld_user', name: 'User', type: 'user' })],
      ['visitCreatedByField', createField({ id: 'fld_cb', name: 'CB', type: 'createdBy' })],
      [
        'visitLastModifiedByField',
        createField({ id: 'fld_lmb', name: 'LMB', type: 'lastModifiedBy' }),
      ],
      ['visitAutoNumberField', createField({ id: 'fld_auto', name: 'Auto', type: 'autoNumber' })],
      ['visitButtonField', createField({ id: 'fld_btn', name: 'Button', type: 'button' })],
    ] as const;

    for (const [methodName, field] of methods) {
      const issues = (
        visitor[methodName] as (input: unknown) => { _unsafeUnwrap(): Array<{ message: string }> }
      )(field as never)._unsafeUnwrap();
      expect(issues).toEqual([
        expect.objectContaining({ message: '✓ Field configuration is valid' }),
      ]);
    }
  });
});
