import { injectable } from '@teable/v2-di';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { domainError, type DomainError } from '@teable/v2-core';
import type { Kysely, CompiledQuery } from 'kysely';
import { sql } from 'kysely';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';

import type { ExplainAnalyzeOutput, ExplainOutput, ExplainJsonOutput } from '../types';

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
 * Error class used to signal intentional rollback after batch EXPLAIN ANALYZE.
 */
class BatchRollbackSignal extends Error {
  constructor(readonly results: Array<ExplainAnalyzeOutput | ExplainOutput | { error: string }>) {
    super('Intentional rollback after batch EXPLAIN ANALYZE');
    this.name = 'BatchRollbackSignal';
  }
}

/**
 * Error class used to signal intentional rollback after sequential EXPLAIN execution.
 */
class SequentialRollbackSignal extends Error {
  constructor(readonly results: SequentialExplainStatementResult[]) {
    super('Intentional rollback after sequential EXPLAIN');
    this.name = 'SequentialRollbackSignal';
  }
}

export type BatchExplainStatement = {
  sql: string;
  parameters: ReadonlyArray<unknown>;
  description: string;
};

export type SequentialExplainStatement = BatchExplainStatement & {
  explainable?: boolean;
  execute?: boolean;
  initialError?: string;
};

export type SequentialExplainStatementResult = {
  explainAnalyze: ExplainAnalyzeOutput | null;
  explainOnly: ExplainOutput | null;
  error: string | null;
};

/**
 * Setup statement to run before EXPLAIN statements.
 * Used to create temporary tables needed by the SQL being explained.
 */
export type SetupStatement = {
  sql: string;
  description: string;
};

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
   * @param setupStatements - Optional setup statements to run before EXPLAIN (e.g., create temp tables)
   * @returns The explain output
   */
  async explain(
    db: Kysely<V1TeableDatabase>,
    sqlStatement: string,
    parameters: ReadonlyArray<unknown>,
    analyze: boolean,
    setupStatements?: ReadonlyArray<SetupStatement>
  ): Promise<Result<ExplainAnalyzeOutput | ExplainOutput, DomainError>> {
    try {
      if (analyze) {
        return await this.runExplainAnalyzeInTransaction(
          db,
          sqlStatement,
          parameters,
          setupStatements
        );
      }
      return await this.runExplainOnly(db, sqlStatement, parameters, setupStatements);
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
    analyze: boolean,
    setupStatements?: ReadonlyArray<SetupStatement>
  ): Promise<Result<ExplainAnalyzeOutput | ExplainOutput, DomainError>> {
    return this.explain(
      db,
      compiled.sql,
      compiled.parameters as unknown[],
      analyze,
      setupStatements
    );
  }

  /**
   * Run EXPLAIN ANALYZE on multiple SQL statements in a single transaction.
   * This is useful when statements depend on each other (e.g., INSERT followed by FK updates).
   *
   * All statements are executed in order within the same transaction, then rolled back.
   * If a statement fails with EXPLAIN ANALYZE, it falls back to EXPLAIN ONLY.
   *
   * @param db - Kysely database instance
   * @param statements - Array of SQL statements to explain
   * @param setupStatements - Optional setup statements to run before EXPLAIN (e.g., create temp tables)
   * @returns Array of explain outputs, one per statement
   */
  async explainBatchInTransaction(
    db: Kysely<V1TeableDatabase>,
    statements: ReadonlyArray<BatchExplainStatement>,
    setupStatements?: ReadonlyArray<SetupStatement>
  ): Promise<Result<Array<ExplainAnalyzeOutput | ExplainOutput | { error: string }>, DomainError>> {
    if (statements.length === 0) {
      return ok([]);
    }

    try {
      await db.transaction().execute(async (trx) => {
        // Run setup statements first (e.g., create tmp_computed_dirty table)
        if (setupStatements && setupStatements.length > 0) {
          for (let i = 0; i < setupStatements.length; i++) {
            const setup = setupStatements[i];
            const setupSavepoint = `setup_${i}`;
            try {
              await sql`SAVEPOINT ${sql.raw(setupSavepoint)}`.execute(trx);
              await sql.raw(setup.sql).execute(trx);
              await sql`RELEASE SAVEPOINT ${sql.raw(setupSavepoint)}`.execute(trx);
            } catch (setupError) {
              // If setup fails, we still continue but log it
              console.warn(`Setup statement failed: ${setup.description}`, setupError);
              try {
                await sql`ROLLBACK TO SAVEPOINT ${sql.raw(setupSavepoint)}`.execute(trx);
                await sql`RELEASE SAVEPOINT ${sql.raw(setupSavepoint)}`.execute(trx);
              } catch (rollbackError) {
                console.warn(
                  `Failed to rollback setup statement after error: ${setup.description}`,
                  rollbackError
                );
              }
            }
          }
        }

        const results: Array<ExplainAnalyzeOutput | ExplainOutput | { error: string }> = [];

        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i];
          const savepointName = `stmt_${i}`;

          try {
            // Use a savepoint so we can continue after statement failures.
            await sql`SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);

            const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${stmt.sql}`;
            const query = sql`${sql.raw(explainSql)}`;
            const compiled = query.compile(trx);
            const finalQuery = {
              ...compiled,
              parameters: [...stmt.parameters],
            };

            const result = await trx.executeQuery<{ 'QUERY PLAN': string }>(finalQuery);
            results.push(this.parseExplainAnalyzeJson(result.rows));
            await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
          } catch (stmtError) {
            // On EXPLAIN ANALYZE failure, try EXPLAIN ONLY as fallback
            try {
              await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);

              // Try EXPLAIN ONLY
              const explainOnlySql = `EXPLAIN (FORMAT JSON) ${stmt.sql}`;
              const explainOnlyQuery = sql`${sql.raw(explainOnlySql)}`;
              const explainOnlyCompiled = explainOnlyQuery.compile(trx);
              const explainOnlyFinalQuery = {
                ...explainOnlyCompiled,
                parameters: [...stmt.parameters],
              };

              const explainOnlyResult = await trx.executeQuery<{ 'QUERY PLAN': string }>(
                explainOnlyFinalQuery
              );
              const explainOnly = this.parseExplainOnlyJson(explainOnlyResult.rows);

              // Return EXPLAIN ONLY result with a note about the ANALYZE failure
              results.push({
                ...explainOnly,
                analyzeError: `EXPLAIN ANALYZE failed, showing EXPLAIN ONLY: ${stmtError instanceof Error ? stmtError.message : String(stmtError)}`,
              } as ExplainOutput & { analyzeError: string });

              await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
            } catch (fallbackError) {
              // Both EXPLAIN ANALYZE and EXPLAIN ONLY failed
              results.push({
                error: `EXPLAIN failed: ${stmtError instanceof Error ? stmtError.message : String(stmtError)}`,
              });
              try {
                await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
                await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              } catch (rollbackError) {
                console.warn(`Failed to rollback after EXPLAIN failure: ${stmt.description}`, {
                  rollbackError,
                  fallbackError,
                  stmtError,
                });
              }
            }
          }
        }

        // Always rollback - we just want the explain output
        throw new BatchRollbackSignal(results);
      });

      // Should not reach here
      return err(
        domainError.invariant({
          message: 'Transaction should have rolled back',
        })
      );
    } catch (error) {
      if (error instanceof BatchRollbackSignal) {
        return ok(error.results);
      }
      return err(
        domainError.infrastructure({
          message: `Batch EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  /**
   * Run a mixed DDL/DML statement sequence in one transaction and roll it back at the end.
   *
   * Non-explainable statements are executed normally so later explainable statements can observe
   * the expected schema/data state. In plan-only mode, explainable statements are executed after
   * EXPLAIN so the sequence can continue against the mutated in-transaction state.
   */
  async explainSequentialInTransaction(
    db: Kysely<V1TeableDatabase>,
    statements: ReadonlyArray<SequentialExplainStatement>,
    analyze: boolean
  ): Promise<Result<SequentialExplainStatementResult[], DomainError>> {
    if (statements.length === 0) {
      return ok([]);
    }

    try {
      await db.transaction().execute(async (trx) => {
        const results: SequentialExplainStatementResult[] = [];

        for (let i = 0; i < statements.length; i++) {
          const statement = statements[i]!;
          const savepointName = `seq_stmt_${i}`;
          await sql`SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);

          try {
            if (statement.initialError) {
              results.push({
                explainAnalyze: null,
                explainOnly: null,
                error: statement.initialError,
              });
              await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              continue;
            }

            if (statement.execute === false) {
              results.push({
                explainAnalyze: null,
                explainOnly: null,
                error: 'Statement capture skipped execution',
              });
              await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              continue;
            }

            if (statement.explainable === false) {
              await this.executeSql(trx, statement.sql, statement.parameters);
              results.push({
                explainAnalyze: null,
                explainOnly: null,
                error: 'PostgreSQL EXPLAIN does not support this statement type',
              });
              await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              continue;
            }

            if (analyze) {
              try {
                const analyzeRows = await this.executeExplainQuery(
                  trx,
                  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.sql}`,
                  statement.parameters
                );
                results.push({
                  explainAnalyze: this.parseExplainAnalyzeJson(analyzeRows),
                  explainOnly: null,
                  error: null,
                });
              } catch (analyzeError) {
                await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
                await sql`SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);

                try {
                  const explainRows = await this.executeExplainQuery(
                    trx,
                    `EXPLAIN (FORMAT JSON) ${statement.sql}`,
                    statement.parameters
                  );
                  results.push({
                    explainAnalyze: null,
                    explainOnly: this.parseExplainOnlyJson(explainRows),
                    error: `EXPLAIN ANALYZE failed: ${analyzeError instanceof Error ? analyzeError.message : String(analyzeError)}`,
                  });
                } catch (explainError) {
                  results.push({
                    explainAnalyze: null,
                    explainOnly: null,
                    error: `EXPLAIN failed: ${explainError instanceof Error ? explainError.message : String(explainError)}`,
                  });
                  await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
                }
              }

              await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              continue;
            }

            let explainOnly: ExplainOutput | null = null;
            let explainError: string | null = null;

            try {
              const explainRows = await this.executeExplainQuery(
                trx,
                `EXPLAIN (FORMAT JSON) ${statement.sql}`,
                statement.parameters
              );
              explainOnly = this.parseExplainOnlyJson(explainRows);
            } catch (error) {
              explainError = `EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`;
            }

            try {
              await this.executeSql(trx, statement.sql, statement.parameters);
            } catch (executeError) {
              const executeErrorMessage = `Statement execution failed: ${executeError instanceof Error ? executeError.message : String(executeError)}`;
              explainError = explainError
                ? `${explainError}; ${executeErrorMessage}`
                : executeErrorMessage;
              await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
            }

            results.push({
              explainAnalyze: null,
              explainOnly,
              error: explainError,
            });
            await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
          } catch (statementError) {
            try {
              await sql`ROLLBACK TO SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
              await sql`RELEASE SAVEPOINT ${sql.raw(savepointName)}`.execute(trx);
            } catch (rollbackError) {
              console.warn('Failed to rollback sequential explain step', {
                statement: statement.description,
                statementError,
                rollbackError,
              });
            }
            results.push({
              explainAnalyze: null,
              explainOnly: null,
              error: `Sequential explain failed: ${statementError instanceof Error ? statementError.message : String(statementError)}`,
            });
          }
        }

        throw new SequentialRollbackSignal(results);
      });

      return err(
        domainError.invariant({
          message: 'Transaction should have rolled back',
        })
      );
    } catch (error) {
      if (error instanceof SequentialRollbackSignal) {
        return ok(error.results);
      }

      return err(
        domainError.infrastructure({
          message: `Sequential EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private async runExplainAnalyzeInTransaction(
    db: Kysely<V1TeableDatabase>,
    sqlStatement: string,
    parameters: ReadonlyArray<unknown>,
    setupStatements?: ReadonlyArray<SetupStatement>
  ): Promise<Result<ExplainAnalyzeOutput, DomainError>> {
    try {
      await db.transaction().execute(async (trx) => {
        // Run setup statements first (e.g., create tmp_computed_dirty table)
        if (setupStatements && setupStatements.length > 0) {
          for (const setup of setupStatements) {
            try {
              await sql.raw(setup.sql).execute(trx);
            } catch (setupError) {
              // If setup fails, we still continue but log it
              console.warn(`Setup statement failed: ${setup.description}`, setupError);
            }
          }
        }

        const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sqlStatement}`;

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
        return ok(this.parseExplainAnalyzeJson(error.rows as Array<{ 'QUERY PLAN': string }>));
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
    parameters: ReadonlyArray<unknown>,
    setupStatements?: ReadonlyArray<SetupStatement>
  ): Promise<Result<ExplainOutput, DomainError>> {
    // If we have setup statements, we need to run in a transaction
    if (setupStatements && setupStatements.length > 0) {
      try {
        return await db.transaction().execute(async (trx) => {
          // Run setup statements
          for (const setup of setupStatements) {
            try {
              await sql.raw(setup.sql).execute(trx);
            } catch (setupError) {
              console.warn(`Setup statement failed: ${setup.description}`, setupError);
            }
          }

          const explainSql = `EXPLAIN (FORMAT JSON) ${sqlStatement}`;
          const query = sql`${sql.raw(explainSql)}`;
          const compiled = query.compile(trx);
          const finalQuery = {
            ...compiled,
            parameters: [...parameters],
          };

          const result = await trx.executeQuery<{ 'QUERY PLAN': string }>(finalQuery);
          return ok(this.parseExplainOnlyJson(result.rows));
        });
      } catch (error) {
        return err(
          domainError.infrastructure({
            message: `EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        );
      }
    }

    // No setup statements, run directly
    try {
      const explainSql = `EXPLAIN (FORMAT JSON) ${sqlStatement}`;

      const query = sql`${sql.raw(explainSql)}`;
      const compiled = query.compile(db);
      const finalQuery = {
        ...compiled,
        parameters: [...parameters],
      };

      const result = await db.executeQuery<{ 'QUERY PLAN': string }>(finalQuery);

      return ok(this.parseExplainOnlyJson(result.rows));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `EXPLAIN failed: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  private async executeExplainQuery(
    db: Kysely<V1TeableDatabase>,
    explainSql: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<Array<{ 'QUERY PLAN': string | object }>> {
    const query = sql`${sql.raw(explainSql)}`;
    const compiled = query.compile(db);
    const finalQuery = {
      ...compiled,
      parameters: [...parameters],
    };

    const result = await db.executeQuery<{ 'QUERY PLAN': string | object }>(finalQuery);
    return result.rows;
  }

  private async executeSql(
    db: Kysely<V1TeableDatabase>,
    statementSql: string,
    parameters: ReadonlyArray<unknown>
  ): Promise<void> {
    const query = sql`${sql.raw(statementSql)}`;
    const compiled = query.compile(db);
    const finalQuery = {
      ...compiled,
      parameters: [...parameters],
    };

    await db.executeQuery(finalQuery);
  }

  private parseExplainAnalyzeJson(
    rows: Array<{ 'QUERY PLAN': string | object }>
  ): ExplainAnalyzeOutput {
    // PostgreSQL FORMAT JSON returns a single row with the JSON plan
    // Some drivers return the value as already-parsed object, others as string
    let plan: ExplainJsonOutput;

    if (rows.length === 1 && typeof rows[0]['QUERY PLAN'] === 'object') {
      // Already parsed (e.g., PGlite)
      const rawPlan = rows[0]['QUERY PLAN'];
      plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
    } else {
      // String format - need to parse
      const jsonStr = rows.map((r) => r['QUERY PLAN']).join('');
      const jsonArray = JSON.parse(jsonStr) as ExplainJsonOutput[];
      plan = jsonArray[0];
    }

    return {
      plan,
      planningTimeMs: plan['Planning Time'],
      executionTimeMs: plan['Execution Time'],
      actualRows: plan.Plan['Actual Rows'],
      estimatedRows: plan.Plan['Plan Rows'],
    };
  }

  private parseExplainOnlyJson(rows: Array<{ 'QUERY PLAN': string | object }>): ExplainOutput {
    // PostgreSQL FORMAT JSON returns a single row with the JSON plan
    // Some drivers return the value as already-parsed object, others as string
    let plan: ExplainJsonOutput;

    if (rows.length === 1 && typeof rows[0]['QUERY PLAN'] === 'object') {
      // Already parsed (e.g., PGlite)
      const rawPlan = rows[0]['QUERY PLAN'];
      plan = Array.isArray(rawPlan) ? rawPlan[0] : rawPlan;
    } else {
      // String format - need to parse
      const jsonStr = rows.map((r) => r['QUERY PLAN']).join('');
      const jsonArray = JSON.parse(jsonStr) as ExplainJsonOutput[];
      plan = jsonArray[0];
    }

    return {
      plan,
      estimatedCost: plan.Plan['Total Cost'],
      estimatedRows: plan.Plan['Plan Rows'],
    };
  }
}
