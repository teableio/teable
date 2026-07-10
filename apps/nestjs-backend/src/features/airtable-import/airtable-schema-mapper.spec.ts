import { createFieldRoSchema, FieldType, ViewType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { buildAirtableImportPlan } from './airtable-schema-mapper';
import type { IAirtableTable } from './airtable.types';

const projectsLinkFieldId = 'fldLinkTasks000001';
const tasksLinkFieldId = 'fldLinkProject0001';

const buildSchema = (): IAirtableTable[] => [
  {
    id: 'tblProjects',
    name: 'Projects',
    primaryFieldId: 'fldName',
    fields: [
      { id: 'fldName', name: 'Name', type: 'singleLineText' },
      { id: 'fldNotes', name: 'Notes', type: 'richText' },
      {
        id: 'fldBudget',
        name: 'Budget',
        type: 'currency',
        options: { precision: 2, symbol: '€' },
      },
      {
        id: 'fldDone',
        name: 'Done',
        type: 'checkbox',
        options: { icon: 'check', color: 'greenBright' },
      },
      {
        id: 'fldPriority',
        name: 'Priority',
        type: 'singleSelect',
        options: {
          choices: [
            { id: 'selA', name: 'High', color: 'redBright' },
            { id: 'selB', name: 'Low' },
            { id: 'selC', name: '' },
          ],
        },
      },
      {
        id: 'fldDue',
        name: 'Due',
        type: 'dateTime',
        options: {
          timeZone: 'client',
          dateFormat: { name: 'european' },
          timeFormat: { name: '24hour' },
        },
      },
      {
        id: 'fldScore',
        name: 'Score',
        type: 'formula',
        options: {
          formula: '{fldBudget} * 2',
          isValid: true,
          result: { type: 'number', options: { precision: 1 } },
        },
      },
      { id: 'fldOwner', name: 'Owner', type: 'singleCollaborator' },
      { id: 'fldFiles', name: 'Files', type: 'multipleAttachments' },
      {
        id: projectsLinkFieldId,
        name: 'Tasks',
        type: 'multipleRecordLinks',
        options: {
          linkedTableId: 'tblTasks',
          prefersSingleRecordLink: false,
          inverseLinkFieldId: tasksLinkFieldId,
          isReversed: false,
        },
      },
      {
        id: 'fldTaskCount',
        name: 'Task count',
        type: 'count',
        options: { recordLinkFieldId: projectsLinkFieldId, isValid: true },
      },
      {
        id: 'fldTaskRollup',
        name: 'Task rollup',
        type: 'rollup',
        // The aggregation is not in the official API options; it arrives via rollupSources.
        options: {
          recordLinkFieldId: projectsLinkFieldId,
          fieldIdInLinkedTable: 'fldTitle',
          isValid: true,
          result: { type: 'number' },
        },
      },
      { id: 'fldAuto', name: 'Auto', type: 'autoNumber' },
      { id: 'fldDur', name: 'Duration', type: 'duration', options: { durationFormat: 'h:mm' } },
      { id: 'fldBtn', name: 'Open', type: 'button' },
      {
        id: 'fldCreated',
        name: 'Created at',
        type: 'createdTime',
        options: { result: { type: 'dateTime', options: { timeZone: 'Asia/Shanghai' } } },
      },
    ],
    views: [
      { id: 'viwGrid', name: 'All projects', type: 'grid' },
      { id: 'viwTimeline', name: 'Roadmap', type: 'timeline' },
      { id: 'viwForm', name: 'Intake', type: 'form' },
    ],
  },
  {
    id: 'tblTasks',
    name: 'Tasks',
    primaryFieldId: 'fldTitle',
    fields: [
      { id: 'fldTitle', name: 'Title', type: 'singleLineText' },
      {
        id: tasksLinkFieldId,
        name: 'Project',
        type: 'multipleRecordLinks',
        options: {
          linkedTableId: 'tblProjects',
          prefersSingleRecordLink: true,
          inverseLinkFieldId: projectsLinkFieldId,
          isReversed: false,
        },
      },
      {
        id: 'fldProjName',
        name: 'Project name',
        type: 'multipleLookupValues',
        options: {
          recordLinkFieldId: tasksLinkFieldId,
          fieldIdInLinkedTable: 'fldName',
          isValid: true,
          result: { type: 'singleLineText' },
        },
      },
      {
        id: 'fldBroken',
        name: 'Broken formula',
        type: 'formula',
        options: { formula: '1/0', isValid: false, result: null },
      },
      {
        id: 'fldAiSummary',
        name: 'AI summary',
        type: 'aiText',
        options: {
          prompt: ['Summarize ', { field: { fieldId: 'fldTitle' } }, ' briefly'],
          referencedFieldIds: ['fldTitle'],
        },
      },
    ],
    views: [],
  },
];

// isPrimary is not part of createFieldRoSchema; it is forwarded to v2 by the
// internal create-table mapper (see table-open-api-v2.mapper.ts mapBaseField).
const isPrimary = (ro: unknown) => (ro as { isPrimary?: boolean }).isPrimary;

describe('buildAirtableImportPlan', () => {
  const plan = buildAirtableImportPlan(buildSchema());
  const projects = plan.tables[0];
  const tasks = plan.tables[1];

  it('produces phase-1 field ros that pass the create-field contract', () => {
    for (const table of plan.tables) {
      for (const field of table.fields) {
        expect(
          () => createFieldRoSchema.parse(field.ro),
          `${table.name}.${field.ro.name}`
        ).not.toThrow();
      }
    }
  });

  it('puts the primary field first with isPrimary set', () => {
    expect(projects.fields[0].airtableFieldId).toBe('fldName');
    expect(isPrimary(projects.fields[0].ro)).toBe(true);
    expect(isPrimary(tasks.fields[0].ro)).toBe(true);
  });

  it('maps plain field types with options', () => {
    const byAirtableId = new Map(projects.fields.map((field) => [field.airtableFieldId, field]));
    expect(byAirtableId.get('fldNotes')?.ro.type).toBe(FieldType.LongText);
    expect(byAirtableId.get('fldBudget')?.ro.options).toMatchObject({
      formatting: { type: 'currency', precision: 2, symbol: '€' },
    });
    expect(byAirtableId.get('fldDue')?.ro.options).toMatchObject({
      formatting: { date: 'D/M/YYYY', time: 'HH:mm', timeZone: 'UTC' },
    });
    expect(byAirtableId.get('fldOwner')?.ro.type).toBe(FieldType.User);
    expect(byAirtableId.get('fldFiles')?.ro.type).toBe(FieldType.Attachment);
  });

  it('passes select choice colors through and falls back when missing', () => {
    const priority = projects.fields.find((field) => field.airtableFieldId === 'fldPriority');
    const choices = (priority?.ro.options as { choices: Array<{ name: string; color: string }> })
      .choices;
    expect(choices[0]).toMatchObject({ name: 'High', color: 'redBright' });
    expect(choices[1].name).toBe('Low');
    expect(choices[1].color).toBeTruthy();
    // Airtable allows blank option names; Teable requires a non-empty name.
    expect(choices[2].name.length).toBeGreaterThan(0);
  });

  it('merges select choices whose names collide after trimming', () => {
    // Airtable identifies choices by id and allows duplicate names (or names
    // differing only by whitespace); Teable rejects duplicate option names.
    const [table] = buildAirtableImportPlan([
      {
        id: 'tblDup',
        name: 'Dup',
        primaryFieldId: 'fldTitle',
        fields: [
          { id: 'fldTitle', name: 'Title', type: 'singleLineText' },
          {
            id: 'fldStatus',
            name: 'Status',
            type: 'singleSelect',
            options: {
              choices: [
                { id: 'selA', name: 'High', color: 'redBright' },
                { id: 'selB', name: 'High ' },
                { id: 'selC', name: ' High' },
                { id: 'selD', name: 'Low' },
              ],
            },
          },
        ],
        views: [],
      },
    ]).tables;

    const status = table.fields.find((field) => field.airtableFieldId === 'fldStatus');
    const choices = (status?.ro.options as { choices: Array<{ name: string; color: string }> })
      .choices;
    expect(choices.map((choice) => choice.name)).toEqual(['High', 'Low']);
    expect(choices[0].color).toBe('redBright');
  });

  it('owns a one-to-many link on the single-link side, independent of table order', () => {
    // Projects.Tasks is multi and Tasks.Project is single; the single side must
    // own the link so the relationship resolves to ManyOne (not ManyMany) no
    // matter which table is traversed first.
    expect(tasks.linkFields).toHaveLength(1);
    expect(projects.linkFields).toHaveLength(0);
    const link = tasks.linkFields[0];
    expect(link.airtableFieldId).toBe(tasksLinkFieldId);
    expect(link.prefersSingle).toBe(true);
    expect(link.inverse).toMatchObject({
      airtableFieldId: projectsLinkFieldId,
      name: 'Tasks',
      prefersSingle: false,
    });
    expect(plan.fieldIdMap[tasksLinkFieldId]).toBeTruthy();
    expect(plan.fieldIdMap[projectsLinkFieldId]).toBeUndefined();
  });

  it('plans count as a rollup and lookup as a real lookup', () => {
    expect(projects.countFields).toHaveLength(1);
    expect(projects.countFields[0]).toMatchObject({
      airtableLinkFieldId: projectsLinkFieldId,
      airtableForeignTableId: 'tblTasks',
    });
    expect(tasks.lookupFields).toHaveLength(1);
    expect(tasks.lookupFields[0]).toMatchObject({
      airtableLinkFieldId: tasksLinkFieldId,
      airtableForeignTableId: 'tblProjects',
      airtableTargetFieldId: 'fldName',
    });
  });

  it('carries a normalized AI prompt for aiText fields without degrading them upfront', () => {
    const aiField = tasks.fields.find((field) => field.airtableFieldId === 'fldAiSummary');
    expect(aiField?.ro.type).toBe(FieldType.LongText);
    expect(aiField?.converter).toBe('aiText');
    expect(aiField?.aiPromptParts).toEqual([
      { text: 'Summarize ' },
      { airtableFieldId: 'fldTitle', fieldName: 'Title' },
      { text: ' briefly' },
    ]);
    expect(
      plan.issues.some(
        (issue) => issue.fieldName === 'AI summary' && issue.code === 'fieldDegraded'
      )
    ).toBe(false);
  });

  it('translates a compatible formula into a live Teable formula field', () => {
    const score = projects.formulaFields.find((field) => field.airtableFieldId === 'fldScore');
    expect(score?.expression).toBe('{fldBudget} * 2');
    // A live formula is not duplicated as a snapshot, and is not reported as degraded.
    expect(projects.fields.find((field) => field.airtableFieldId === 'fldScore')).toBeUndefined();
    expect(plan.issues.some((issue) => issue.fieldName === 'Score')).toBe(false);
  });

  it('snapshots an invalid formula instead of emitting a broken live formula', () => {
    expect(
      tasks.formulaFields.find((field) => field.airtableFieldId === 'fldBroken')
    ).toBeUndefined();
    const snapshot = tasks.fields.find((field) => field.airtableFieldId === 'fldBroken');
    expect(snapshot?.converter).toMatch(/^snapshot/);
    expect(
      plan.issues.some(
        (issue) => issue.fieldName === 'Broken formula' && issue.code === 'fieldDegraded'
      )
    ).toBe(true);
  });

  it('snapshots a rollup when no shared base model supplies its aggregation', () => {
    // the default `plan` is built without rollupSources
    expect(projects.rollupFields).toHaveLength(0);
    const snapshot = projects.fields.find((field) => field.airtableFieldId === 'fldTaskRollup');
    expect(snapshot?.converter).toMatch(/^snapshot/);
  });

  it('recreates a rollup as a live Teable rollup when the shared base model supplies its aggregation', () => {
    const rollupSources = new Map([
      [
        'fldTaskRollup',
        {
          relationColumnId: projectsLinkFieldId,
          foreignTableRollupColumnId: 'fldTitle',
          aggregation: 'COUNTA(values)',
          filter: null,
        },
      ],
    ]);
    const livePlan = buildAirtableImportPlan(buildSchema(), rollupSources);
    const liveProjects = livePlan.tables[0];
    const rollup = liveProjects.rollupFields.find((f) => f.airtableFieldId === 'fldTaskRollup');
    expect(rollup?.expression).toBe('counta({values})');
    expect(rollup?.airtableForeignTableId).toBe('tblTasks');
    // a live rollup is not also emitted as a snapshot
    expect(liveProjects.fields.find((f) => f.airtableFieldId === 'fldTaskRollup')).toBeUndefined();
  });

  it('degrades unsupported types and reports issues', () => {
    const byAirtableId = new Map(projects.fields.map((field) => [field.airtableFieldId, field]));
    expect(byAirtableId.get('fldAuto')?.ro.type).toBe(FieldType.Number);
    expect(byAirtableId.get('fldDur')?.ro.type).toBe(FieldType.Number);
    expect(byAirtableId.get('fldBtn')?.ro.type).toBe(FieldType.SingleLineText);
    expect(byAirtableId.get('fldCreated')?.ro.type).toBe(FieldType.Date);
    const degradedFields = plan.issues
      .filter((issue) => issue.code === 'fieldDegraded')
      .map((issue) => issue.fieldName);
    expect(degradedFields).toEqual(
      expect.arrayContaining(['Auto', 'Duration', 'Open', 'Created at'])
    );
  });

  it('maps supported views and reports skipped ones, defaulting to a grid', () => {
    expect(projects.views).toEqual([
      { name: 'All projects', type: ViewType.Grid },
      { name: 'Intake', type: ViewType.Form },
    ]);
    expect(
      plan.issues.some((issue) => issue.code === 'viewSkipped' && issue.viewName === 'Roadmap')
    ).toBe(true);
    expect(tasks.views).toEqual([{ type: ViewType.Grid }]);
  });

  it('covers every non-inverse field in the field id map', () => {
    const schema = buildSchema();
    for (const table of schema) {
      for (const field of table.fields) {
        // Projects.Tasks (multi) is now the inverse side — the single-link
        // Tasks.Project owns the link — so it is mapped at import time, not now.
        if (field.id === projectsLinkFieldId) continue;
        // formula/rollup are skipped (not imported), so they are not mapped.
        if (field.type === 'formula' || field.type === 'rollup') continue;
        expect(plan.fieldIdMap[field.id], `${table.name}.${field.name}`).toBeTruthy();
      }
    }
  });
});

describe('buildAirtableImportPlan edge cases', () => {
  it('degrades the primary field to a text snapshot when it maps to an incompatible type', () => {
    const plan = buildAirtableImportPlan([
      {
        id: 'tblA',
        name: 'A',
        primaryFieldId: 'fldChk',
        fields: [
          { id: 'fldChk', name: 'Done', type: 'checkbox' },
          { id: 'fldText', name: 'Text', type: 'singleLineText' },
        ],
        views: [],
      },
    ]);
    const table = plan.tables[0];
    expect(isPrimary(table.fields[0].ro)).toBe(true);
    expect(table.fields[0].ro.type).toBe(FieldType.SingleLineText);
    expect(table.fields[0].converter).toBe('snapshotText');
    // the checkbox itself is replaced, not duplicated
    expect(table.fields.filter((field) => field.airtableFieldId === 'fldChk')).toHaveLength(1);
  });

  it('treats a link without a valid inverse as one-way and self-links as pairable', () => {
    const plan = buildAirtableImportPlan([
      {
        id: 'tblA',
        name: 'A',
        primaryFieldId: 'fldName',
        fields: [
          { id: 'fldName', name: 'Name', type: 'singleLineText' },
          {
            id: 'fldOneWay',
            name: 'One way',
            type: 'multipleRecordLinks',
            options: { linkedTableId: 'tblA', prefersSingleRecordLink: false },
          },
          {
            id: 'fldSelfA',
            name: 'Parent',
            type: 'multipleRecordLinks',
            options: {
              linkedTableId: 'tblA',
              prefersSingleRecordLink: true,
              inverseLinkFieldId: 'fldSelfB',
            },
          },
          {
            id: 'fldSelfB',
            name: 'Children',
            type: 'multipleRecordLinks',
            options: {
              linkedTableId: 'tblA',
              prefersSingleRecordLink: false,
              inverseLinkFieldId: 'fldSelfA',
            },
          },
        ],
        views: [],
      },
    ]);
    const table = plan.tables[0];
    expect(table.linkFields).toHaveLength(2);
    const oneWay = table.linkFields.find((field) => field.airtableFieldId === 'fldOneWay');
    expect(oneWay?.inverse).toBeUndefined();
    const selfPair = table.linkFields.find((field) => field.airtableFieldId === 'fldSelfA');
    expect(selfPair?.inverse?.airtableFieldId).toBe('fldSelfB');
  });

  it('carries a link "limit record selection to a view" into the plan', () => {
    const plan = buildAirtableImportPlan([
      {
        id: 'tblA',
        name: 'A',
        primaryFieldId: 'fldName',
        fields: [
          { id: 'fldName', name: 'Name', type: 'singleLineText' },
          {
            id: 'fldLink',
            name: 'Linked',
            type: 'multipleRecordLinks',
            options: {
              linkedTableId: 'tblA',
              prefersSingleRecordLink: false,
              viewIdForRecordSelection: 'viwLimit',
            },
          },
        ],
        views: [],
      },
    ]);
    const link = plan.tables[0].linkFields.find((field) => field.airtableFieldId === 'fldLink');
    expect(link?.viewIdForRecordSelection).toBe('viwLimit');
  });

  it('falls back to a text snapshot for unknown future field types', () => {
    const plan = buildAirtableImportPlan([
      {
        id: 'tblA',
        name: 'A',
        primaryFieldId: 'fldName',
        fields: [
          { id: 'fldName', name: 'Name', type: 'singleLineText' },
          { id: 'fldNew', name: 'Mystery', type: 'someFutureType' },
        ],
        views: [],
      },
    ]);
    const mystery = plan.tables[0].fields.find((field) => field.airtableFieldId === 'fldNew');
    expect(mystery?.ro.type).toBe(FieldType.LongText);
    expect(mystery?.converter).toBe('snapshotText');
  });
});
