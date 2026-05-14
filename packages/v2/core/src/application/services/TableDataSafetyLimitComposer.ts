import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  DEFAULT_TABLE_DATA_SAFETY_LIMITS,
  resolveTableDataSafetyLimits,
  type ResolvedTableDataSafetyLimitConfig,
  type TableDataSafetyLimitConfig,
} from '../../domain/shared/TableDataSafetyLimits';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableDataSafetyLimitPlugin } from '../../ports/TableDataSafetyLimitPlugin';
import { v2CoreTokens } from '../../ports/tokens';

type TableDataSafetyLimitGroupName = keyof TableDataSafetyLimitConfig;

type TableDataSafetyLimitRuleDefinition = {
  readonly group: TableDataSafetyLimitGroupName;
  readonly key: string;
};

export type TableDataSafetyLimitPluginContribution = {
  readonly pluginName: string;
  readonly limits: TableDataSafetyLimitConfig;
};

export type TableDataSafetyLimitInspectionRuleSource = {
  readonly pluginName: string;
  readonly value: number;
  readonly selected: boolean;
  readonly default?: boolean;
};

export type TableDataSafetyLimitInspectionRule = {
  readonly group: TableDataSafetyLimitGroupName;
  readonly key: string;
  readonly effectiveValue?: number;
  readonly defaultValue?: number;
  readonly sources: ReadonlyArray<TableDataSafetyLimitInspectionRuleSource>;
};

export type TableDataSafetyLimitInspection = {
  readonly plugins: ReadonlyArray<string>;
  readonly contributions: ReadonlyArray<TableDataSafetyLimitPluginContribution>;
  readonly composed?: TableDataSafetyLimitConfig;
  readonly resolved: ResolvedTableDataSafetyLimitConfig;
  readonly rules: ReadonlyArray<TableDataSafetyLimitInspectionRule>;
};

const minDefined = (values: ReadonlyArray<number | undefined>): number | undefined => {
  const definedValues = values.filter((value): value is number => typeof value === 'number');
  if (!definedValues.length) return undefined;
  return Math.min(...definedValues);
};

const TABLE_DATA_SAFETY_LIMIT_RULES = [
  { group: 'fieldOptions', key: 'maxBytes' },
  { group: 'fieldOptions', key: 'maxSelectChoices' },
  { group: 'fieldOptions', key: 'maxSelectChoiceNameLength' },
  { group: 'fieldOptions', key: 'maxSelectDefaultValues' },
  { group: 'recordValues', key: 'maxCellValueBytes' },
  { group: 'recordValues', key: 'maxRecordFieldsBytes' },
  { group: 'recordValues', key: 'maxRecordsPerMutation' },
  { group: 'computed', key: 'maxComputedCellValueBytes' },
  { group: 'computed', key: 'maxFormulaLength' },
  { group: 'tableSchema', key: 'maxTablesPerBase' },
  { group: 'tableSchema', key: 'maxFieldsPerTable' },
  { group: 'tableSchema', key: 'maxViewsPerTable' },
  { group: 'tableSchema', key: 'maxCreateTableFields' },
  { group: 'tableSchema', key: 'maxCreateTableViews' },
  { group: 'tableSchema', key: 'maxCreateTableRecords' },
  { group: 'tableSchema', key: 'maxRowsPerTable' },
  { group: 'viewConfig', key: 'maxFilterItems' },
  { group: 'viewConfig', key: 'maxFilterDepth' },
  { group: 'viewConfig', key: 'maxSortItems' },
  { group: 'viewConfig', key: 'maxGroupItems' },
  { group: 'viewConfig', key: 'maxOptionsBytes' },
  { group: 'displayText', key: 'maxNameLength' },
  { group: 'displayText', key: 'maxDescriptionLength' },
] as const satisfies ReadonlyArray<TableDataSafetyLimitRuleDefinition>;

const readLimitValue = (
  limits: TableDataSafetyLimitConfig | ResolvedTableDataSafetyLimitConfig | undefined,
  rule: TableDataSafetyLimitRuleDefinition
): number | undefined => {
  const group = limits?.[rule.group] as Record<string, number | undefined> | undefined;
  return group?.[rule.key];
};

export class StaticTableDataSafetyLimitPlugin implements ITableDataSafetyLimitPlugin {
  readonly name = 'static-table-data-safety-limit';

  constructor(private readonly limits: TableDataSafetyLimitConfig) {}

  contribute(): Result<TableDataSafetyLimitConfig, DomainError> {
    return ok(this.limits);
  }
}

export class ExecutionContextTableDataSafetyLimitPlugin implements ITableDataSafetyLimitPlugin {
  readonly name = 'execution-context-table-data-safety-limit';

  contribute(
    context: IExecutionContext
  ): Result<TableDataSafetyLimitConfig | undefined, DomainError> {
    return ok(context.config?.tableLimits);
  }
}

export const createDefaultTableDataSafetyLimitComposer = (
  ...plugins: ReadonlyArray<ITableDataSafetyLimitPlugin>
): TableDataSafetyLimitComposer =>
  new TableDataSafetyLimitComposer([new ExecutionContextTableDataSafetyLimitPlugin(), ...plugins]);

@injectable()
export class TableDataSafetyLimitComposer {
  constructor(
    @inject(v2CoreTokens.tableDataSafetyLimitPlugins)
    private readonly plugins?: ITableDataSafetyLimitPlugin[]
  ) {}

  async compose(
    context: IExecutionContext
  ): Promise<Result<TableDataSafetyLimitConfig | undefined, DomainError>> {
    return TableDataSafetyLimitComposer.compose(this.plugins ?? [], context);
  }

  async inspect(
    context: IExecutionContext
  ): Promise<Result<TableDataSafetyLimitInspection, DomainError>> {
    return TableDataSafetyLimitComposer.inspect(this.plugins ?? [], context);
  }

  static async compose(
    plugins: ReadonlyArray<ITableDataSafetyLimitPlugin>,
    context: IExecutionContext
  ): Promise<Result<TableDataSafetyLimitConfig | undefined, DomainError>> {
    const contributions: TableDataSafetyLimitConfig[] = [];

    for (const plugin of plugins) {
      const result = await plugin.contribute(context);
      if (result.isErr()) return err(result.error);
      if (result.value) contributions.push(result.value);
    }

    return ok(TableDataSafetyLimitComposer.composeContributions(contributions));
  }

  static async inspect(
    plugins: ReadonlyArray<ITableDataSafetyLimitPlugin>,
    context: IExecutionContext
  ): Promise<Result<TableDataSafetyLimitInspection, DomainError>> {
    const contributions: TableDataSafetyLimitPluginContribution[] = [];

    for (const plugin of plugins) {
      const result = await plugin.contribute(context);
      if (result.isErr()) return err(result.error);
      if (result.value) {
        contributions.push({
          pluginName: plugin.name,
          limits: result.value,
        });
      }
    }

    const composed = TableDataSafetyLimitComposer.composeContributions(
      contributions.map((contribution) => contribution.limits)
    );
    const resolved = resolveTableDataSafetyLimits(composed);

    return ok({
      plugins: plugins.map((plugin) => plugin.name),
      contributions,
      composed,
      resolved,
      rules: TABLE_DATA_SAFETY_LIMIT_RULES.map((rule) =>
        TableDataSafetyLimitComposer.inspectRule(rule, contributions, composed, resolved)
      ),
    });
  }

  private static inspectRule(
    rule: TableDataSafetyLimitRuleDefinition,
    contributions: ReadonlyArray<TableDataSafetyLimitPluginContribution>,
    composed: TableDataSafetyLimitConfig | undefined,
    resolved: ResolvedTableDataSafetyLimitConfig
  ): TableDataSafetyLimitInspectionRule {
    const composedValue = readLimitValue(composed, rule);
    const effectiveValue = readLimitValue(resolved, rule);
    const defaultValue = readLimitValue(DEFAULT_TABLE_DATA_SAFETY_LIMITS, rule);
    const contributionSources = contributions
      .map((contribution) => {
        const value = readLimitValue(contribution.limits, rule);
        if (typeof value !== 'number') return null;
        return {
          pluginName: contribution.pluginName,
          value,
          selected: value === composedValue,
        };
      })
      .filter((source): source is TableDataSafetyLimitInspectionRuleSource => Boolean(source));
    const sources: TableDataSafetyLimitInspectionRuleSource[] =
      typeof defaultValue === 'number'
        ? [
            {
              pluginName: 'default-table-data-safety-limit',
              value: defaultValue,
              selected: effectiveValue === defaultValue,
              default: true,
            },
            ...contributionSources,
          ]
        : contributionSources;

    return {
      group: rule.group,
      key: rule.key,
      effectiveValue,
      defaultValue,
      sources,
    };
  }

  private static composeContributions(
    contributions: ReadonlyArray<TableDataSafetyLimitConfig>
  ): TableDataSafetyLimitConfig | undefined {
    if (!contributions.length) return undefined;

    return {
      fieldOptions: {
        maxBytes: minDefined(contributions.map((config) => config.fieldOptions?.maxBytes)),
        maxSelectChoices: minDefined(
          contributions.map((config) => config.fieldOptions?.maxSelectChoices)
        ),
        maxSelectChoiceNameLength: minDefined(
          contributions.map((config) => config.fieldOptions?.maxSelectChoiceNameLength)
        ),
        maxSelectDefaultValues: minDefined(
          contributions.map((config) => config.fieldOptions?.maxSelectDefaultValues)
        ),
      },
      recordValues: {
        maxCellValueBytes: minDefined(
          contributions.map((config) => config.recordValues?.maxCellValueBytes)
        ),
        maxRecordFieldsBytes: minDefined(
          contributions.map((config) => config.recordValues?.maxRecordFieldsBytes)
        ),
        maxRecordsPerMutation: minDefined(
          contributions.map((config) => config.recordValues?.maxRecordsPerMutation)
        ),
      },
      computed: {
        maxComputedCellValueBytes: minDefined(
          contributions.map((config) => config.computed?.maxComputedCellValueBytes)
        ),
        maxFormulaLength: minDefined(
          contributions.map((config) => config.computed?.maxFormulaLength)
        ),
      },
      tableSchema: {
        maxTablesPerBase: minDefined(
          contributions.map((config) => config.tableSchema?.maxTablesPerBase)
        ),
        maxFieldsPerTable: minDefined(
          contributions.map((config) => config.tableSchema?.maxFieldsPerTable)
        ),
        maxViewsPerTable: minDefined(
          contributions.map((config) => config.tableSchema?.maxViewsPerTable)
        ),
        maxCreateTableFields: minDefined(
          contributions.map((config) => config.tableSchema?.maxCreateTableFields)
        ),
        maxCreateTableViews: minDefined(
          contributions.map((config) => config.tableSchema?.maxCreateTableViews)
        ),
        maxCreateTableRecords: minDefined(
          contributions.map((config) => config.tableSchema?.maxCreateTableRecords)
        ),
        maxRowsPerTable: minDefined(
          contributions.map((config) => config.tableSchema?.maxRowsPerTable)
        ),
      },
      viewConfig: {
        maxFilterItems: minDefined(
          contributions.map((config) => config.viewConfig?.maxFilterItems)
        ),
        maxFilterDepth: minDefined(
          contributions.map((config) => config.viewConfig?.maxFilterDepth)
        ),
        maxSortItems: minDefined(contributions.map((config) => config.viewConfig?.maxSortItems)),
        maxGroupItems: minDefined(contributions.map((config) => config.viewConfig?.maxGroupItems)),
        maxOptionsBytes: minDefined(
          contributions.map((config) => config.viewConfig?.maxOptionsBytes)
        ),
      },
      displayText: {
        maxNameLength: minDefined(contributions.map((config) => config.displayText?.maxNameLength)),
        maxDescriptionLength: minDefined(
          contributions.map((config) => config.displayText?.maxDescriptionLength)
        ),
      },
    };
  }
}
