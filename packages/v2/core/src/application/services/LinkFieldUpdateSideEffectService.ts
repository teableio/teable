import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import type { LinkFieldConfig } from '../../domain/table/fields/types/LinkFieldConfig';
import { LinkFieldUpdateSideEffectVisitor } from '../../domain/table/fields/visitors/LinkFieldUpdateSideEffectVisitor';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { TableUpdateResult } from '../../domain/table/TableMutator';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';
import { TableUpdateFlow } from './TableUpdateFlow';

export type LinkFieldUpdateSideEffectServiceInput = {
  /** The table containing the updated link field */
  table: Table;
  /** The updated field (must be a LinkField) */
  updatedField: Field;
  /** The specs that were applied to update the field */
  updateSpecs: ReadonlyArray<ISpecification<Table, ITableSpecVisitor>>;
  /** Foreign tables that may be affected */
  foreignTables: ReadonlyArray<Table>;
  /** The previous config before update (for detecting oneWay changes) */
  previousConfig?: LinkFieldConfig;
  /** State of foreign tables (for tracking changes across multiple side effects) */
  tableState?: ReadonlyMap<string, Table>;
};

export type LinkFieldUpdateSideEffectServiceResult = {
  /** Events generated during side effect processing */
  events: ReadonlyArray<IDomainEvent>;
  /** Updated table state (foreign tables may have changed) */
  tableState: ReadonlyMap<string, Table>;
};

/**
 * Application service: coordinates repositories and update flow for link field update side effects.
 *
 * This service handles:
 * - oneWay → twoWay: Creates symmetric field in foreign table
 * - twoWay → oneWay: Deletes symmetric field from foreign table
 *
 * Domain logic lives in LinkFieldUpdateSideEffectVisitor; this class only orchestrates
 * persistence and events.
 */
@injectable()
export class LinkFieldUpdateSideEffectService {
  constructor(
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow
  ) {}

  @TraceSpan()
  async execute(
    context: ExecutionContextPort.IExecutionContext,
    input: LinkFieldUpdateSideEffectServiceInput
  ): Promise<Result<LinkFieldUpdateSideEffectServiceResult, DomainError>> {
    const service = this;
    return await safeTry<LinkFieldUpdateSideEffectServiceResult, DomainError>(async function* () {
      const { table, updatedField, foreignTables, previousConfig } = input;

      // Only process link fields
      if (!(updatedField instanceof LinkField)) {
        return ok({
          events: [],
          tableState: input.tableState ?? new Map(foreignTables.map((t) => [t.id().toString(), t])),
        });
      }

      // If no previous config provided, we can't detect oneWay changes
      if (!previousConfig) {
        return ok({
          events: [],
          tableState: input.tableState ?? new Map(foreignTables.map((t) => [t.id().toString(), t])),
        });
      }

      const foreignTableState = input.tableState
        ? new Map<string, Table>(input.tableState)
        : new Map<string, Table>(foreignTables.map((t) => [t.id().toString(), t]));

      // Check if this update requires symmetric field changes
      const currentConfig = updatedField.config();
      if (
        !LinkFieldUpdateSideEffectVisitor.requiresSymmetricFieldChange(
          previousConfig,
          currentConfig
        )
      ) {
        return ok({ events: [], tableState: foreignTableState });
      }

      // Create visitor to collect side effects
      const visitor = LinkFieldUpdateSideEffectVisitor.create({
        table,
        foreignTables,
      });

      // Collect side effects
      const sideEffects = yield* visitor.collect({
        currentField: updatedField,
        previousConfig,
        nextConfig: currentConfig,
      });

      if (sideEffects.length === 0) {
        return ok({ events: [], tableState: foreignTableState });
      }

      const events: IDomainEvent[] = [];

      // Apply each side effect
      for (const sideEffect of sideEffects) {
        const foreignTable = foreignTableState.get(sideEffect.foreignTable.id().toString());
        if (!foreignTable) {
          return err(domainError.notFound({ message: 'Foreign table not found in state' }));
        }

        const updateResult = yield* await service.tableUpdateFlow.execute(
          context,
          { table: foreignTable },
          (candidate) =>
            sideEffect.mutateSpec
              .mutate(candidate)
              .map((updated) => TableUpdateResult.create(updated, sideEffect.mutateSpec)),
          { publishEvents: false }
        );

        foreignTableState.set(updateResult.table.id().toString(), updateResult.table);
        events.push(...updateResult.events);
      }

      return ok({ events, tableState: foreignTableState });
    });
  }
}
