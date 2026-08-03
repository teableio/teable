import {
  getRandomString,
  generateTableId,
  generateFieldId,
  generateViewId,
  generateRecordId,
  generateAttachmentId,
  generateWorkflowId,
  generateWorkflowTriggerId,
  generateWorkflowActionId,
  generateWorkflowDecisionId,
  identify,
  IdPrefix,
} from './id-generator';

describe('ID Generators', () => {
  it('generates a random string of correct length', () => {
    const randomStr = getRandomString(5);
    expect(randomStr.length).toBe(5);
  });

  it('generates a table ID with correct prefix and length', () => {
    const tableId = generateTableId();
    expect(tableId.startsWith(IdPrefix.Table)).toBe(true);
    expect(tableId.length).toBe(IdPrefix.Table.length + 16);
  });

  it('generates a field ID with correct prefix and length', () => {
    const fieldId = generateFieldId();
    expect(fieldId.startsWith(IdPrefix.Field)).toBe(true);
    expect(fieldId.length).toBe(IdPrefix.Field.length + 16);
  });

  it('generates a view ID with correct prefix and length', () => {
    const viewId = generateViewId();
    expect(viewId.startsWith(IdPrefix.View)).toBe(true);
    expect(viewId.length).toBe(IdPrefix.View.length + 16);
  });

  it('generates a record ID with correct prefix and length', () => {
    const recordId = generateRecordId();
    expect(recordId.startsWith(IdPrefix.Record)).toBe(true);
    expect(recordId.length).toBe(IdPrefix.Record.length + 16);
  });

  it('generates a attachment ID with correct prefix and length', () => {
    const attachmentId = generateAttachmentId();
    expect(attachmentId.startsWith(IdPrefix.Attachment)).toBe(true);
    expect(attachmentId.length).toBe(IdPrefix.Attachment.length + 16);
  });

  it('generates a workflow ID with correct prefix and length', () => {
    const workflowId = generateWorkflowId();
    expect(workflowId.startsWith(IdPrefix.Workflow)).toBe(true);
    expect(workflowId.length).toBe(IdPrefix.Workflow.length + 16);
  });

  it('generates a workflowTrigger ID with correct prefix and length', () => {
    const workflowTriggerId = generateWorkflowTriggerId();
    expect(workflowTriggerId.startsWith(IdPrefix.WorkflowTrigger)).toBe(true);
    expect(workflowTriggerId.length).toBe(IdPrefix.WorkflowTrigger.length + 16);
  });

  it('generates a workflowAction ID with correct prefix and length', () => {
    const workflowActionId = generateWorkflowActionId();
    expect(workflowActionId.startsWith(IdPrefix.WorkflowAction)).toBe(true);
    expect(workflowActionId.length).toBe(IdPrefix.WorkflowAction.length + 16);
  });

  it('generates a workflowDecision ID with correct prefix and length', () => {
    const workflowDecisionId = generateWorkflowDecisionId();
    expect(workflowDecisionId.startsWith(IdPrefix.WorkflowDecision)).toBe(true);
    expect(workflowDecisionId.length).toBe(IdPrefix.WorkflowDecision.length + 16);
  });

  it('identifies an ID prefix', () => {
    const id = generateTableId();
    expect(identify(id)).toBe(IdPrefix.Table);
  });

  it('returns undefined if the ID prefix is unrecognized', () => {
    const id = 'xyz123456789';
    expect(identify(id)).toBeUndefined();
  });

  it('returns undefined if the ID is too short to have a prefix', () => {
    const id = 'x';
    expect(identify(id)).toBeUndefined();
  });
});
