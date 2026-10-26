import type { ICustomHttpExceptionData, ILocalization } from '@teable/core';
import type {
  IV2SchemaIntegrityFilterStatus,
  IV2SchemaIntegrityCheckResult,
  IV2SchemaIntegrityI18nMessage,
  IV2SchemaIntegrityRepairResult,
} from '@teable/openapi';

export type IntegrityResult = IV2SchemaIntegrityCheckResult | IV2SchemaIntegrityRepairResult;
export type IntegrityPhase = 'check' | 'repair';
export type IntegrityScope = 'base' | 'table';
export type IntegrityFilterStatus = IV2SchemaIntegrityFilterStatus;

export type IntegritySummary = {
  total: number;
  success: number;
  error: number;
  warn: number;
  skipped: number;
  running: number;
  repaired: number;
  manual: number;
  unchanged: number;
  issueCount: number;
};

export type ResultGroup = {
  fieldId: string;
  fieldName: string;
  results: IntegrityResult[];
};

export type TableResultGroup = {
  baseId: string;
  tableId: string;
  tableName: string;
  results: IntegrityResult[];
  groups: ResultGroup[];
};

export type GroupDisplayState = {
  allSuccess: boolean;
  hasError: boolean;
  hasWarn: boolean;
};

export type Translate = {
  (key: string): string;
  (key: string, options: Record<string, unknown>): string;
};

type IntegrityI18nMessage = IV2SchemaIntegrityI18nMessage;

export const integrityFilterStatuses: IntegrityFilterStatus[] = [
  'success',
  'warn',
  'error',
  'skipped',
];

const getRuleTypeAndTarget = (ruleId: string) => {
  const [type, ...rest] = ruleId.split(':');
  return {
    type,
    target: rest.join(':'),
  };
};

const getSystemColumnNameFromRuleId = (ruleId: string) => {
  const { type, target } = getRuleTypeAndTarget(ruleId);
  if (!type.startsWith('system_') || !target) {
    return undefined;
  }

  return target;
};

const defaultSummary = (): IntegritySummary => ({
  total: 0,
  success: 0,
  error: 0,
  warn: 0,
  skipped: 0,
  running: 0,
  repaired: 0,
  manual: 0,
  unchanged: 0,
  issueCount: 0,
});

export const upsertResult = <T extends IntegrityResult>(results: T[], nextResult: T): T[] => {
  const index = results.findIndex((result) => result.id === nextResult.id);
  if (index === -1) {
    return [...results, nextResult];
  }

  const next = [...results];
  next[index] = nextResult;
  return next;
};

export const createSummary = (results: IntegrityResult[]): IntegritySummary => {
  return results.reduce<IntegritySummary>((summary, result) => {
    if (result.status !== 'running') {
      summary.total += 1;
    }

    if (result.status === 'success') {
      summary.success += 1;
    }

    if (result.status === 'error') {
      summary.error += 1;
    }

    if (result.status === 'warn') {
      summary.warn += 1;
    }

    if (result.status === 'skipped') {
      summary.skipped += 1;
    }

    if (result.status === 'running') {
      summary.running += 1;
    }

    if ('outcome' in result) {
      if (result.outcome === 'repaired') {
        summary.repaired += 1;
      }

      if (result.outcome === 'manual') {
        summary.manual += 1;
      }

      if (result.outcome === 'unchanged') {
        summary.unchanged += 1;
      }
    }

    summary.issueCount = summary.error + summary.warn + summary.skipped;
    return summary;
  }, defaultSummary());
};

export const filterResultsByStatuses = (
  results: IntegrityResult[],
  statuses: ReadonlyArray<IntegrityFilterStatus>
) => {
  if (!statuses.length) {
    return [];
  }

  const selectedStatuses = new Set(statuses);
  return results.filter((result) => {
    if (result.status === 'running' || result.status === 'pending') {
      return true;
    }

    return selectedStatuses.has(result.status as IntegrityFilterStatus);
  });
};

export const groupResults = (results: IntegrityResult[]): ResultGroup[] => {
  const groups = new Map<string, ResultGroup>();

  for (const result of results) {
    const systemColumnName =
      result.fieldId === '__system__' ? getSystemColumnNameFromRuleId(result.ruleId) : undefined;
    const key = systemColumnName
      ? `__system__:${systemColumnName}`
      : result.fieldId || '__general__';
    const existing = groups.get(key);

    if (existing) {
      existing.results.push(result);
      continue;
    }

    groups.set(key, {
      fieldId: key,
      fieldName: systemColumnName || result.fieldName,
      results: [result],
    });
  }

  return Array.from(groups.values());
};

export const groupResultsByTable = (results: IntegrityResult[]): TableResultGroup[] => {
  const groups = new Map<string, IntegrityResult[]>();

  for (const result of results) {
    const key = `${result.baseId || '__unknown_base__'}:${result.tableId || '__unknown_table__'}`;
    const existing = groups.get(key);

    if (existing) {
      existing.push(result);
      continue;
    }

    groups.set(key, [result]);
  }

  return Array.from(groups.values()).map((tableResults) => ({
    baseId: tableResults[0]?.baseId || '',
    tableId: tableResults[0]?.tableId || '',
    tableName: tableResults[0]?.tableName || '',
    results: tableResults,
    groups: groupResults(tableResults),
  }));
};

// Server error translations live in the `sdk` namespace (`httpErrors.*`).
const translateErrorLocalization = (t: Translate, localization?: ILocalization) =>
  localization?.i18nKey ? t(`sdk:${localization.i18nKey}`, localization.context ?? {}) : undefined;

export const getErrorMessage = (error: unknown, fallback: string, t?: Translate) => {
  if (error instanceof Error) {
    const { localization } =
      ((error as { data?: unknown }).data as ICustomHttpExceptionData | undefined) ?? {};
    return (t && translateErrorLocalization(t, localization)) || error.message;
  }

  return fallback;
};

export const getDialogDescription = (
  t: Translate,
  options: { baseId?: string; tableId?: string; baseName?: string; tableName?: string }
) => {
  if (!options.tableId) {
    return t('table:table.integrity.v2.dialogDescriptionNoTable');
  }

  return t('table:table.integrity.v2.dialogDescription', {
    tableName: options.tableName || options.tableId,
  });
};

export const getPhaseText = (t: Translate, phase: IntegrityPhase, type: 'badge' | 'running') => {
  if (type === 'running') {
    return phase === 'check'
      ? t('table:table.integrity.v2.checking')
      : t('table:table.integrity.v2.repairing');
  }

  return phase === 'check'
    ? t('table:table.integrity.v2.phase.check')
    : t('table:table.integrity.v2.phase.repair');
};

export const getGroupDisplayState = (results: IntegrityResult[]): GroupDisplayState => {
  const hasError = results.some((result) => result.status === 'error');
  const hasWarn = results.some((result) => result.status === 'warn' || result.status === 'skipped');
  const allSuccess = results.every(
    (result) => result.status === 'success' || result.status === 'running'
  );

  return {
    allSuccess,
    hasError,
    hasWarn,
  };
};

export const getGroupDisplayName = (t: Translate, group: ResultGroup) => {
  if (group.fieldId.startsWith('__system__:')) {
    return t('table:table.integrity.v2.rule.systemColumn', {
      columnName: group.fieldId.slice('__system__:'.length),
    });
  }

  if (group.fieldId === '__system__') {
    return t('table:table.integrity.v2.systemColumns');
  }

  if (group.fieldId) {
    return group.fieldName || group.fieldId;
  }

  return t('table:table.integrity.v2.general');
};

const getSystemColumnType = (ruleDescription: string) => {
  const match = /\(([^()]+)\)\s*$/.exec(ruleDescription);
  return match?.[1];
};

const localizeSystemDetail = (t: Translate, detail: string) => {
  const patterns: Array<{
    pattern: RegExp;
    key: string;
  }> = [
    {
      pattern: /^system column "(.+)" not found$/,
      key: 'table:table.integrity.v2.detail.systemColumnMissing',
    },
    {
      pattern: /^system column "(.+)" should be NOT NULL$/,
      key: 'table:table.integrity.v2.detail.systemColumnNotNull',
    },
    {
      pattern: /^system column "(.+)" should have UNIQUE index$/,
      key: 'table:table.integrity.v2.detail.systemColumnUnique',
    },
    {
      pattern: /^system column "(.+)" should be PRIMARY KEY$/,
      key: 'table:table.integrity.v2.detail.systemColumnPrimaryKey',
    },
    {
      pattern: /^system column "(.+)" should have default expression$/,
      key: 'table:table.integrity.v2.detail.systemColumnDefault',
    },
  ];

  for (const { pattern, key } of patterns) {
    const match = detail.match(pattern);
    if (match?.[1]) {
      return t(key, { columnName: match[1] });
    }
  }

  return detail;
};

// Keep legacy Base messages compatible while backend and frontend releases roll independently.
const localizedMessageKeys: Record<string, string> = {
  'Schema is valid': 'table:table.integrity.v2.message.schemaValid',
  'Schema element missing': 'table:table.integrity.v2.message.schemaElementMissing',
  'Schema already valid': 'table:table.integrity.v2.message.schemaAlreadyValid',
  'Schema repaired successfully': 'table:table.integrity.v2.message.schemaRepaired',
  'Rule requires manual repair': 'table:table.integrity.v2.message.manualRepair',
  'No repair statements available': 'table:table.integrity.v2.message.noRepairStatements',
  'Skipped: dependencies not satisfied': 'table:table.integrity.v2.message.skippedDependencies',
  'Schema integrity check stream connected':
    'table:table.integrity.v2.message.checkStreamConnected',
  'Base schema integrity check stream connected':
    'table:table.integrity.v2.message.baseCheckStreamConnected',
  'Project schema integrity check stream connected':
    'table:table.integrity.v2.message.baseCheckStreamConnected',
  'Schema integrity repair stream connected':
    'table:table.integrity.v2.message.repairStreamConnected',
  'Base schema integrity repair stream connected':
    'table:table.integrity.v2.message.baseRepairStreamConnected',
  'Project schema integrity repair stream connected':
    'table:table.integrity.v2.message.baseRepairStreamConnected',
  'Schema integrity check completed': 'table:table.integrity.v2.message.checkCompleted',
  'Base schema integrity check completed': 'table:table.integrity.v2.message.baseCheckCompleted',
  'Project schema integrity check completed': 'table:table.integrity.v2.message.baseCheckCompleted',
  'Schema integrity repair completed': 'table:table.integrity.v2.message.repairCompleted',
  'Base schema integrity repair completed': 'table:table.integrity.v2.message.baseRepairCompleted',
  'Project schema integrity repair completed':
    'table:table.integrity.v2.message.baseRepairCompleted',
  'Skipped: status not selected for repair':
    'table:table.integrity.v2.message.skippedStatusNotSelected',
  'Skipped: repair unavailable': 'table:table.integrity.v2.message.skippedRepairUnavailable',
};

export const translateIntegrityMessage = (
  t: Translate,
  message?: IntegrityI18nMessage
): string | undefined => {
  if (!message) {
    return undefined;
  }

  if (message.key) {
    return t(message.key, message.values || {});
  }

  return message.fallback;
};

/** Rule-id prefix → `table:table.integrity.v2.rule.*` key. */
const RULE_DESCRIPTION_KEY: Readonly<Record<string, string>> = {
  column: 'column',
  not_null: 'notNull',
  column_unique: 'columnUnique',
  fk_column: 'fkColumn',
  index: 'index',
  unique_index: 'uniqueIndex',
  fk: 'foreignKey',
  junction_table: 'junctionTable',
  junction_unique: 'junctionUnique',
  junction_index: 'junctionIndex',
  junction_fk: 'junctionForeignKey',
  reference: 'reference',
  generated_column: 'generatedColumn',
  generated_meta: 'generatedMeta',
  link_value_column: 'linkValueColumn',
  order_column: 'orderColumn',
  field_meta: 'fieldMeta',
  symmetric_field: 'symmetricField',
  system_not_null: 'notNull',
  system_unique: 'uniqueIndex',
  system_primary_key: 'primaryKey',
  system_default: 'defaultExpression',
  table_exists: 'tableExists',
  system_orphaned_link_storage: 'orphanedLinkStorage',
  table_missing_primary_field: 'primaryField',
  meta: 'metadata',
  select_options: 'selectOptions',
  default_backfill: 'defaultBackfill',
  cond_match_index: 'conditionalMatchIndex',
  connection: 'connection',
  completion: 'completion',
  unexpected: 'unexpected',
};

export const getLocalizedRuleDescription = (t: Translate, result: IntegrityResult) => {
  const { type } = getRuleTypeAndTarget(result.ruleId);

  if (type === 'system_column') {
    const dataType = getSystemColumnType(result.ruleDescription);
    return dataType
      ? t('table:table.integrity.v2.rule.columnTyped', { dataType })
      : t('table:table.integrity.v2.rule.column');
  }

  const key = Object.hasOwn(RULE_DESCRIPTION_KEY, type) ? RULE_DESCRIPTION_KEY[type] : undefined;
  return key ? t(`table:table.integrity.v2.rule.${key}`) : result.ruleDescription;
};

export const getLocalizedResultMessage = (t: Translate, result: IntegrityResult) => {
  const translated = translateErrorLocalization(t, result.localization);
  if (translated) {
    return translated;
  }

  if (!result.message) {
    return undefined;
  }

  if (result.message.startsWith('Schema validation failed')) {
    return t('table:table.integrity.v2.message.schemaValidationFailed');
  }

  const messageKey = localizedMessageKeys[result.message];
  if (messageKey) {
    return t(messageKey);
  }

  return result.message;
};

export const getLocalizedDetailItems = (
  t: Translate,
  items?: ReadonlyArray<
    | string
    | {
        code?: string;
        message: IntegrityI18nMessage;
        description?: IntegrityI18nMessage;
      }
  >
): string[] | undefined => {
  if (!items?.length) {
    return undefined;
  }

  return items.flatMap((item) => {
    if (typeof item === 'string') {
      return [localizeSystemDetail(t, item)];
    }

    const message = translateIntegrityMessage(t, item.message);
    const description = translateIntegrityMessage(t, item.description);

    if (message && description) {
      return [`${message}: ${description}`];
    }

    const localized = description || message || item.code;
    return localized ? [localized] : [];
  });
};

export const getLocalizedRepairReason = (t: Translate, result: IntegrityResult) => {
  return translateIntegrityMessage(t, result.repair?.reason);
};

export const getLocalizedRepairDescription = (t: Translate, result: IntegrityResult) => {
  return translateIntegrityMessage(t, result.repair?.description);
};

export const hasExecutableRepairStatements = (results: ReadonlyArray<IntegrityResult>) => {
  return results.some((result) => Boolean(result.details?.statements?.length));
};
