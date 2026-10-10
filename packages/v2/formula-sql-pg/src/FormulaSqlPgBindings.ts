import { FormulaCompileBudget } from './FormulaCompileBudget';

const MAX_INLINE_EXPRESSION_LENGTH = 256;

/** Lazy SQL CTEs retain independent channels and CASE short-circuit semantics. */
export class FormulaSqlPgBindings {
  private readonly entries: Array<{ name: string; sql: string; dependencies: number[] }> = [];
  private readonly bySql = new Map<string, string>();
  private readonly rendered = new Map<string, string>();
  private readonly renderedSelect = new Map<string, string>();
  constructor(readonly budget = new FormulaCompileBudget()) {}

  bind(sql: string): string {
    const existing = this.bySql.get(sql);
    if (existing) return existing;
    this.budget.check('bindings', this.entries.length + 1);
    const name = `__formula_${this.entries.length}`;
    const reference = this.budget.sql`(SELECT value FROM "${name}")`;
    this.entries.push({ name, sql, dependencies: this.dependencies(sql) });
    this.rendered.clear();
    this.renderedSelect.clear();
    this.bySql.set(sql, reference);
    return reference;
  }

  reference(sql: string, shared = false): string {
    if (
      /^(?:NULL(?:::.*)?|TRUE|FALSE|[-+]?\d+(?:\.\d+)?|'(?:[^']|'')*'|"[^"]+"\."[^"]+")$/.test(sql)
    )
      return sql;
    return shared || sql.length > MAX_INLINE_EXPRESSION_LENGTH ? this.bind(sql) : sql;
  }

  private dependencies(sql: string): number[] {
    // Scan literals and references together; no full-size sanitized SQL copy.
    const dependencies: number[] = [];
    for (const match of sql.matchAll(/'(?:[^']|'')*'|\(SELECT value FROM "__formula_(\d+)"\)/g)) {
      if (match[1] !== undefined) dependencies.push(Number(match[1]));
    }
    return dependencies;
  }

  private collectDependencies(sql: string): Set<number> {
    const needed = new Set<number>();
    const pending = this.dependencies(sql);
    while (pending.length) {
      const index = pending.pop()!;
      const entry = this.entries[index];
      if (!entry || needed.has(index)) continue;
      needed.add(index);
      for (const dependency of entry.dependencies) pending.push(dependency);
    }
    return needed;
  }

  render(sql: string, forceSelect = false): string {
    const cache = forceSelect ? this.renderedSelect : this.rendered;
    const cached = cache.get(sql);
    if (cached !== undefined) return cached;
    const needed = this.collectDependencies(sql);
    let bytes = this.budget.bytes(sql);
    if (needed.size) {
      bytes += this.budget.bytes('(WITH  SELECT )') + (needed.size - 1) * 2;
      for (const index of needed) {
        const entry = this.entries[index];
        bytes +=
          this.budget.bytes(entry.name) +
          this.budget.bytes(entry.sql) +
          this.budget.bytes('"" AS MATERIALIZED (SELECT  AS value)');
      }
    } else if (forceSelect) bytes += this.budget.bytes('(SELECT )');
    this.budget.check('sqlBytes', bytes);
    if (!needed.size) {
      const result = forceSelect ? this.budget.sql`(SELECT ${sql})` : sql;
      cache.set(sql, result);
      return result;
    }
    const definitions: string[] = [];
    for (let index = 0; index < this.entries.length; index++) {
      if (!needed.has(index)) continue;
      const entry = this.entries[index];
      definitions.push(
        this.budget.sql`"${entry.name}" AS MATERIALIZED (SELECT ${entry.sql} AS value)`
      );
    }
    const result = this.budget.sql`(WITH ${this.budget.join(definitions, ', ')} SELECT ${sql})`;
    cache.set(sql, result);
    return result;
  }
}
