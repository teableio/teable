import { FieldType, Relationship } from '@teable/core';
import type { IImportAirtableIssue } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { AirtableImportService } from './airtable-import.service';
import type { IPlannedDirectField, IPlannedLinkField } from './airtable-schema-mapper';

const service = new AirtableImportService(
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  undefined
);

const linkField = (prefersSingle: boolean): IPlannedLinkField => ({
  airtableFieldId: 'fldLink',
  teableFieldId: 'fldTeable0000000001',
  name: 'Link',
  airtableForeignTableId: 'tblForeign',
  prefersSingle,
});

describe('AirtableImportService.decideRelationship', () => {
  it('follows the declared Airtable relationship', () => {
    expect(service['decideRelationship'](linkField(true))).toBe(Relationship.ManyOne);
    expect(service['decideRelationship'](linkField(false))).toBe(Relationship.ManyMany);
  });
});

describe('AirtableImportService.applyAiConfig', () => {
  const plannedAiField = (): IPlannedDirectField => ({
    airtableFieldId: 'fldAi',
    converter: 'aiText',
    aiPromptParts: [
      { text: 'Summarize ' },
      { airtableFieldId: 'fldTitle', fieldName: 'Title' },
      { airtableFieldId: 'fldGone', fieldName: 'Gone' },
    ],
    ro: { id: 'fldTeableAi00000001', name: 'Summary', type: FieldType.LongText, options: {} },
  });
  const fieldIdMap = { fldTitle: 'fldTeableTitle00001' };

  it('builds a customization AI config with mapped field references', () => {
    const issues: IImportAirtableIssue[] = [];
    const ro = service['applyAiConfig'](
      plannedAiField(),
      'openai@gpt@main',
      fieldIdMap,
      'T',
      issues
    );
    expect(ro.aiConfig).toMatchObject({
      type: 'customization',
      modelKey: 'openai@gpt@main',
      prompt: 'Summarize {fldTeableTitle00001}Gone',
      isAutoFill: false,
    });
    expect(issues).toHaveLength(0);
  });

  it('keeps the snapshot and reports when no AI model is configured', () => {
    const issues: IImportAirtableIssue[] = [];
    const ro = service['applyAiConfig'](plannedAiField(), undefined, fieldIdMap, 'T', issues);
    expect(ro.aiConfig).toBeUndefined();
    expect(issues[0]).toMatchObject({
      code: 'fieldDegraded',
      fieldName: 'Summary',
      fromType: 'aiText',
      reason: 'no AI model is configured',
    });
  });

  it('passes non-AI fields through untouched', () => {
    const issues: IImportAirtableIssue[] = [];
    const planned: IPlannedDirectField = {
      airtableFieldId: 'fldText',
      converter: 'string',
      ro: { name: 'Plain', type: FieldType.SingleLineText, options: {} },
    };
    expect(service['applyAiConfig'](planned, 'model@x@y', {}, 'T', issues)).toBe(planned.ro);
    expect(issues).toHaveLength(0);
  });
});
