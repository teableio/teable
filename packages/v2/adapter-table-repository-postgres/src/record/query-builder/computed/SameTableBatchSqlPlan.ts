type FormulaFieldSqlFragmentParams = {
  fieldId: string;
  columnAlias: string;
  expressionSql: string;
  cseEligible: boolean;
};

type CteLevelSqlPlanParams = {
  name: string;
  level: number;
  previousCteName?: string;
  fragments: ReadonlyArray<FormulaFieldSqlFragment>;
};

const normalizeExpressionKey = (sqlText: string): string => sqlText.replace(/\s+/g, ' ').trim();

export class FormulaFieldSqlFragment {
  readonly fieldId: string;
  readonly columnAlias: string;
  readonly expressionSql: string;
  readonly normalizedKey: string;
  readonly cseEligible: boolean;

  private constructor(params: FormulaFieldSqlFragmentParams) {
    this.fieldId = params.fieldId;
    this.columnAlias = params.columnAlias;
    this.expressionSql = params.expressionSql;
    this.normalizedKey = normalizeExpressionKey(params.expressionSql);
    this.cseEligible = params.cseEligible;
  }

  static create(params: FormulaFieldSqlFragmentParams): FormulaFieldSqlFragment {
    return new FormulaFieldSqlFragment(params);
  }
}

export class FormulaCseBinding {
  constructor(
    readonly normalizedKey: string,
    readonly alias: string,
    readonly expressionSql: string,
    readonly fieldIds: ReadonlyArray<string>
  ) {}

  selectItemSql(): string {
    return `(${this.expressionSql}) as "${this.alias}"`;
  }

  referenceSql(cseAlias = '__cse'): string {
    return `"${cseAlias}"."${this.alias}"`;
  }
}

export class CteLevelSqlPlan {
  readonly name: string;
  readonly level: number;
  readonly previousCteName?: string;
  readonly fragments: ReadonlyArray<FormulaFieldSqlFragment>;
  readonly cseBindings: ReadonlyArray<FormulaCseBinding>;
  private readonly cseBindingsByKey: ReadonlyMap<string, FormulaCseBinding>;

  private constructor(
    params: CteLevelSqlPlanParams,
    cseBindings: ReadonlyArray<FormulaCseBinding>
  ) {
    this.name = params.name;
    this.level = params.level;
    this.previousCteName = params.previousCteName;
    this.fragments = params.fragments;
    this.cseBindings = cseBindings;
    this.cseBindingsByKey = new Map(cseBindings.map((binding) => [binding.normalizedKey, binding]));
  }

  static create(params: CteLevelSqlPlanParams): CteLevelSqlPlan {
    const grouped = new Map<string, { firstIndex: number; fragments: FormulaFieldSqlFragment[] }>();

    params.fragments.forEach((fragment, index) => {
      if (!fragment.cseEligible) return;

      const entry = grouped.get(fragment.normalizedKey);
      if (!entry) {
        grouped.set(fragment.normalizedKey, {
          firstIndex: index,
          fragments: [fragment],
        });
        return;
      }
      entry.fragments.push(fragment);
    });

    const entriesForCse = [...grouped.entries()]
      .filter(([, entry]) => entry.fragments.length >= 2)
      .sort(([, a], [, b]) => a.firstIndex - b.firstIndex);

    const bindings = entriesForCse.map(
      ([key, entry], index) =>
        new FormulaCseBinding(
          key,
          `__cse_${index}`,
          entry.fragments[0]!.expressionSql,
          entry.fragments.map((fragment) => fragment.fieldId)
        )
    );

    return new CteLevelSqlPlan(params, bindings);
  }

  buildSelectColumnsSql(): string {
    return this.fragments
      .map((fragment) => {
        const binding = fragment.cseEligible
          ? this.cseBindingsByKey.get(fragment.normalizedKey)
          : undefined;
        const valueSql = binding ? binding.referenceSql() : `(${fragment.expressionSql})`;
        return `${valueSql} as "${fragment.columnAlias}"`;
      })
      .join(', ');
  }

  buildCseJoinSql(): string {
    if (this.cseBindings.length === 0) return '';
    const selectItems = this.cseBindings.map((binding) => binding.selectItemSql()).join(', ');
    return ` CROSS JOIN LATERAL (SELECT ${selectItems}) AS "__cse"`;
  }

  buildCteSql(fromClause: string): string {
    const selectColumns = this.buildSelectColumnsSql();
    const cseJoin = this.buildCseJoinSql();
    return `"${this.name}" AS (SELECT "t"."__id", ${selectColumns} ${fromClause}${cseJoin})`;
  }
}
