const MAX_INLINE_EXPRESSION_LENGTH = 256;

/**
 * Lazy, formula-local SQL bindings. A scalar CTE reference is evaluated only when
 * its CASE branch is demanded. MATERIALIZED prevents PostgreSQL from substituting
 * the expression at every reference; a plain SELECT alias does not do that.
 * Each value/error channel has its own binding so reading a value cannot eagerly
 * evaluate an unused error branch.
 */
export class FormulaSqlPgBindings {
  private readonly entries: Array<{ name: string; sql: string; dependencies: number[] }> = [];
  private readonly bySql = new Map<string, string>();

  bind(sql: string): string {
    const existing = this.bySql.get(sql);
    if (existing) return existing;
    const name = `__formula_${this.entries.length}`;
    const reference = `(SELECT value FROM "${name}")`;
    this.entries.push({ name, sql, dependencies: this.dependencies(sql) });
    this.bySql.set(sql, reference);
    return reference;
  }

  reference(sql: string, shared = false): string {
    // Keep literals and column references visible to literal-sensitive coercion.
    if (
      /^(?:NULL(?:::.*)?|TRUE|FALSE|[-+]?\d+(?:\.\d+)?|'(?:[^']|'')*'|"[^"]+"\."[^"]+")$/.test(sql)
    ) {
      return sql;
    }
    // Bound expansion without materializing every arithmetic operation. Small
    // single-use expressions stay inline; their size is reconsidered at the next
    // node, so a long chain cannot keep expanding without a boundary.
    return shared || sql.length > MAX_INLINE_EXPRESSION_LENGTH ? this.bind(sql) : sql;
  }

  private dependencies(sql: string): number[] {
    // Ignore SQL string literals, including doubled quotes. A user value that
    // looks like a binding reference must never make an unused CTE reachable.
    const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
    return [...withoutLiterals.matchAll(/\(SELECT value FROM "__formula_(\d+)"\)/g)].map((match) =>
      Number(match[1])
    );
  }

  render(sql: string, forceSelect = false): string {
    // Only emit bindings reachable from this output channel. Besides producing
    // smaller SQL, this excludes unused branches from planning when possible.
    const needed = new Set<number>();
    const visit = (index: number): void => {
      if (needed.has(index)) return;
      const entry = this.entries[index];
      if (!entry) return;
      needed.add(index);
      entry.dependencies.forEach(visit);
    };
    this.dependencies(sql).forEach(visit);
    const definitions = this.entries
      .filter((_entry, index) => needed.has(index))
      .map((entry) => `"${entry.name}" AS MATERIALIZED (SELECT ${entry.sql} AS value)`);
    if (!definitions.length) return forceSelect ? `(SELECT ${sql})` : sql;
    return `(WITH ${definitions.join(', ')} SELECT ${sql})`;
  }
}
