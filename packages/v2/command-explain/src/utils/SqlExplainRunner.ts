import { injectable } from '@teable/v2-di';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { domainError, type DomainError } from '@teable/v2-core';
import type { Kysely, CompiledQuery } from 'kysely';
import { sql } from 'kysely';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';

import type { ExplainAnalyzeOutput, ExplainOutput } from '../types';

/**
 * Error class used to signal intentional rollback after EXPLAIN ANALYZE.
 */
class RollbackSignal extends Error {
  constructor(readonly rows: unknown[]) {
    super('Intentional rollback after EXPLAIN ANALYZE');
    this.name = 'RollbackSignal';
  }
}

/**
 * Utility for running SQL EXPLAIN statements.
 */
@injectable()
export class SqlExplainRunner {
  /**
   * Run EXPLAIN or EXPLAIN ANALYZE on a SQL statement.
   *
   * @param db - Kysely database instance
   * @param sqlStatement - The SQL statement to explain
   * @param parameters - Parameters for the SQL statement
   * @param analyze - If true, run EXPLAIN ANALYZE (executes in transaction then rollback)
   * @returns The explain output
   */
  async explain(
    db: Kysely<V1TeableDatabase>,
    sqlStatement: string,
    parameters: ReadonlyArray<unknown>,
    analyze: boolean
  ): Promise<Result<ExplainAnalyzeOutput | ExplainOutput, DomainError>> {
    try {
      if (analyze) {
        return await this.runExplainAnalyzeInTransaction(db, sqlStatement, parameters);
      }
      return await this.runExplainOnly(db, sqlStatement, parameters);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `SQL EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  /**
   * Run EXPLAIN (without execution) on a compiled query.
   */
  async explainCompiled(
    db: Kysely<V1TeableDatabase>,
    compiled: CompiledQuery,
    analyze: boolean
  ): Promise<Result<ExplainAnalyzeOutput | ExplainOutput, DomainError>> {
    return this.explain(db, compiled.sql, compiled.parameters as unknown[], analyze);
  }

  private async runExplainAnalyzeInTransaction(
    db: Kysely<V1TeableDatabase>,
    sqlStatement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<Result<ExplainAnalyzeOutput, DomainError>> {
    try {
      await db.transaction().execute(async (trx) => {
        const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sqlStatement}`;

        // Build the query with parameters using template literal
        const query = sql`${sql.raw(explainSql)}`;
        const compiled = query.compile(trx);
        // Replace parameters manually if needed
        const finalQuery = {
          ...compiled,
          parameters: [...parameters],
        };

        const result = await trx.executeQuery<{ 'QUERY PLAN': string }>(finalQuery);

        // Always rollback - we just want the explain output
        throw new RollbackSignal(result.rows);
      });

      // Should not reach here
      return err(
        domainError.invariant({
          message: 'Transaction should have rolled back',
        })
      );
    } catch (error) {
      if (error instanceof RollbackSignal) {
        return ok(this.parseExplainAnalyze(error.rows as Array<{ 'QUERY PLAN': string }>));
      }
      return err(
        domainError.infrastructure({
          message: `EXPLAIN ANALYZE failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private async runExplainOnly(
    db: Kysely<V1TeableDatabase>,
    sqlStatement: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<Result<ExplainOutput, DomainError>> {
    try {
      const explainSql = `EXPLAIN (FORMAT TEXT) ${sqlStatement}`;

      const query = sql`${sql.raw(explainSql)}`;
      const compiled = query.compile(db);
      const finalQuery = {
        ...compiled,
        parameters: [...parameters],
      };

      const result = await db.executeQuery<{ 'QUERY PLAN': string }>(finalQuery);

      return ok(this.parseExplainOnly(result.rows));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private parseExplainAnalyze(rows: Array<{ 'QUERY PLAN': string }>): ExplainAnalyzeOutput {
    const raw = rows.map((r) => r['QUERY PLAN']).join('\n');

    // Parse timing info from EXPLAIN ANALYZE output
    const planningMatch = raw.match(/Planning Time:\s*([\d.]+)\s*ms/);
    const executionMatch = raw.match(/Execution Time:\s*([\d.]+)\s*ms/);
    const actualRowsMatch = raw.match(/actual.*rows=(\d+)/);
    const estimatedRowsMatch = raw.match(/rows=(\d+)/);

    return {
      raw,
      planningTimeMs: planningMatch ? parseFloat(planningMatch[1]) : undefined,
      executionTimeMs: executionMatch ? parseFloat(executionMatch[1]) : undefined,
      actualRows: actualRowsMatch ? parseInt(actualRowsMatch[1], 10) : undefined,
      estimatedRows: estimatedRowsMatch ? parseInt(estimatedRowsMatch[1], 10) : undefined,
    };
  }

  private parseExplainOnly(rows: Array<{ 'QUERY PLAN': string }>): ExplainOutput {
    const raw = rows.map((r) => r['QUERY PLAN']).join('\n');

    // Parse cost and rows from EXPLAIN output
    // Format: (cost=0.00..35.50 rows=2550 width=4)
    const costMatch = raw.match(/cost=([\d.]+)\.\.([\d.]+)/);
    const rowsMatch = raw.match(/rows=(\d+)/);

    return {
      raw,
      estimatedCost: costMatch ? parseFloat(costMatch[2]) : undefined,
      estimatedRows: rowsMatch ? parseInt(rowsMatch[1], 10) : undefined,
    };
  }
}
