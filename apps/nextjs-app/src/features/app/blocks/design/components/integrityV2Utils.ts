import type {
  IV2SchemaIntegrityFilterStatus,
  IV2SchemaIntegrityCheckResult,
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
    const key = result.tableId || '__unknown_table__';
    const existing = groups.get(key);

    if (existing) {
      existing.push(result);
      continue;
    }

    groups.set(key, [result]);
  }

  return Array.from(groups.entries()).map(([tableId, tableResults]) => ({
    tableId: tableId === '__unknown_table__' ? '' : tableId,
    tableName: tableResults[0]?.tableName || '',
    results: tableResults,
    groups: groupResults(tableResults),
  }));
};

export const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    return error.message;
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
  const match = ruleDescription.match(/\(([^()]+)\)\s*$/);
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
  'Schema integrity repair stream connected':
    'table:table.integrity.v2.message.repairStreamConnected',
  'Base schema integrity repair stream connected':
    'table:table.integrity.v2.message.baseRepairStreamConnected',
  'Schema integrity check completed': 'table:table.integrity.v2.message.checkCompleted',
  'Base schema integrity check completed': 'table:table.integrity.v2.message.baseCheckCompleted',
  'Schema integrity repair completed': 'table:table.integrity.v2.message.repairCompleted',
  'Base schema integrity repair completed': 'table:table.integrity.v2.message.baseRepairCompleted',
};

export const getLocalizedRuleDescription = (t: Translate, result: IntegrityResult) => {
  const { type } = getRuleTypeAndTarget(result.ruleId);

  switch (type) {
    case 'column':
      return t('table:table.integrity.v2.rule.column');
    case 'not_null':
      return t('table:table.integrity.v2.rule.notNull');
    case 'column_unique':
      return t('table:table.integrity.v2.rule.columnUnique');
    case 'fk_column':
      return t('table:table.integrity.v2.rule.fkColumn');
    case 'index':
      return t('table:table.integrity.v2.rule.index');
    case 'unique_index':
      return t('table:table.integrity.v2.rule.uniqueIndex');
    case 'fk':
      return t('table:table.integrity.v2.rule.foreignKey');
    case 'junction_table':
      return t('table:table.integrity.v2.rule.junctionTable');
    case 'junction_unique':
      return t('table:table.integrity.v2.rule.junctionUnique');
    case 'junction_index':
      return t('table:table.integrity.v2.rule.junctionIndex');
    case 'junction_fk':
      return t('table:table.integrity.v2.rule.junctionForeignKey');
    case 'reference':
      return t('table:table.integrity.v2.rule.reference');
    case 'generated_column':
      return t('table:table.integrity.v2.rule.generatedColumn');
    case 'generated_meta':
      return t('table:table.integrity.v2.rule.generatedMeta');
    case 'link_value_column':
      return t('table:table.integrity.v2.rule.linkValueColumn');
    case 'order_column':
      return t('table:table.integrity.v2.rule.orderColumn');
    case 'field_meta':
      return t('table:table.integrity.v2.rule.fieldMeta');
    case 'symmetric_field':
      return t('table:table.integrity.v2.rule.symmetricField');
    case 'system_column': {
      const dataType = getSystemColumnType(result.ruleDescription);
      if (dataType) {
        return t('table:table.integrity.v2.rule.columnTyped', {
          dataType,
        });
      }
      return t('table:table.integrity.v2.rule.column');
    }
    case 'system_not_null':
      return t('table:table.integrity.v2.rule.notNull');
    case 'system_unique':
      return t('table:table.integrity.v2.rule.uniqueIndex');
    case 'system_primary_key':
      return t('table:table.integrity.v2.rule.primaryKey');
    case 'system_default':
      return t('table:table.integrity.v2.rule.defaultExpression');
    case 'connection':
      return t('table:table.integrity.v2.rule.connection');
    case 'completion':
      return t('table:table.integrity.v2.rule.completion');
    case 'unexpected':
      return t('table:table.integrity.v2.rule.unexpected');
    default:
      return result.ruleDescription;
  }
};

export const getLocalizedResultMessage = (t: Translate, result: IntegrityResult) => {
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
  items?: ReadonlyArray<string>
): string[] | undefined => {
  if (!items?.length) {
    return undefined;
  }

  return items.map((item) => localizeSystemDetail(t, item));
};
