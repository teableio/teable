// Types
export type {
  CreateTableTemplateInputOptions,
  SingleTableSeed,
  TableTemplateDefinition,
  TableTemplateTablePreview,
  TemplateRecord,
  TemplateSeed,
  TemplateTableSeed,
} from './types';

// Utils (for creating custom templates)
export {
  createFieldId,
  createRecordId,
  createSelectOption,
  createSelectOptionId,
  createTableId,
  createTemplate,
  createTextColumns,
  MAX_TEMPLATE_RECORDS,
  MIN_TEMPLATE_RECORDS,
  normalizeTemplateRecords,
  resolveTemplateRecordCount,
  singleTable,
} from './utils';

// Template field creators
export {
  createAllBaseFields,
  createAllFieldTypesFields,
  createContentCalendarFields,
  createPersonalFinanceFields,
  createProjectTrackerFields,
  createSimpleFields,
  createTodoFields,
} from './templates';

// Individual templates
export {
  allBaseFieldsTemplate,
  allFieldTypesTemplate,
  bugTriageTemplate,
  contentCalendarTemplate,
  crmTemplate,
  hrManagementTemplate,
  personalFinanceTemplate,
  projectTrackerTemplate,
  simpleTableTemplate,
  todoTemplate,
} from './templates';

// Template registry
import {
  allBaseFieldsTemplate,
  allFieldTypesTemplate,
  bugTriageTemplate,
  contentCalendarTemplate,
  crmTemplate,
  hrManagementTemplate,
  personalFinanceTemplate,
  projectTrackerTemplate,
  simpleTableTemplate,
  todoTemplate,
} from './templates';
import type { TableTemplateDefinition } from './types';

export const tableTemplates = [
  simpleTableTemplate,
  allBaseFieldsTemplate,
  todoTemplate,
  bugTriageTemplate,
  crmTemplate,
  hrManagementTemplate,
  contentCalendarTemplate,
  projectTrackerTemplate,
  personalFinanceTemplate,
  allFieldTypesTemplate,
] as const;

export type TableTemplateKey = (typeof tableTemplates)[number]['key'];

export const getTableTemplate = (key: TableTemplateKey): TableTemplateDefinition | undefined =>
  tableTemplates.find((template) => template.key === key);
