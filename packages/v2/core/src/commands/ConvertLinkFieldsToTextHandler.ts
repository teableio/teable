import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { withLinkTextConversionBatch } from '../application/services/LinkTextConversionBatch';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { Table } from '../domain/table/Table';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ConvertLinkFieldsToTextCommand } from './ConvertLinkFieldsToTextCommand';
import { UpdateFieldCommand } from './UpdateFieldCommand';
import { UpdateFieldHandler } from './UpdateFieldHandler';

export class ConvertLinkFieldsToTextResult {
  constructor(readonly events: ReadonlyArray<IDomainEvent>) {}
}

@CommandHandler(ConvertLinkFieldsToTextCommand)
@injectable()
export class ConvertLinkFieldsToTextHandler implements ICommandHandler<
  ConvertLinkFieldsToTextCommand,
  ConvertLinkFieldsToTextResult
> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tables: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.unitOfWork) private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(UpdateFieldHandler) private readonly updateField: UpdateFieldHandler
  ) {}

  async handle(
    context: IExecutionContext,
    command: ConvertLinkFieldsToTextCommand
  ): Promise<Result<ConvertLinkFieldsToTextResult, DomainError>> {
    const handler = this;
    return this.unitOfWork.withTransaction(
      context,
      async (metaContext) =>
        handler.unitOfWork.withTransaction(
          metaContext,
          async (transactionContext) =>
            safeTry<ConvertLinkFieldsToTextResult, DomainError>(async function* () {
              const selected = new Set(
                command.fields.map(({ tableId, fieldId }) => `${tableId}:${fieldId}`)
              );
              const links: Array<{ tableId: string; fieldId: string }> = [];
              for (const target of command.fields) {
                const spec = yield* Table.specs().byId(target.tableId).build();
                const table = yield* await handler.tables.findOne(transactionContext, spec);
                const field = yield* table.getField((candidate) =>
                  candidate.id().equals(target.fieldId)
                );
                if (!(field instanceof LinkField)) continue;
                const symmetric = field.symmetricFieldId();
                if (symmetric && !selected.has(`${field.foreignTableId()}:${symmetric}`)) {
                  return err(
                    domainError.validation({
                      message: 'Both reciprocal link fields must be converted together',
                    })
                  );
                }
                if (symmetric) {
                  const foreignSpec = yield* Table.specs().byId(field.foreignTableId()).build();
                  const foreign = yield* await handler.tables.findOne(
                    transactionContext,
                    foreignSpec
                  );
                  const counterpart = yield* foreign.getField((candidate) =>
                    candidate.id().equals(symmetric)
                  );
                  if (
                    !(counterpart instanceof LinkField) ||
                    !counterpart.foreignTableId().equals(table.id()) ||
                    !counterpart.symmetricFieldId()?.equals(field.id())
                  ) {
                    return err(
                      domainError.conflict({ message: 'Reciprocal link metadata changed' })
                    );
                  }
                }
                links.push({
                  tableId: target.tableId.toString(),
                  fieldId: target.fieldId.toString(),
                });
              }
              const batchContext = withLinkTextConversionBatch(transactionContext, links, selected);
              const events: IDomainEvent[] = [];
              for (const target of command.fields) {
                const update = yield* UpdateFieldCommand.create(
                  {
                    tableId: target.tableId.toString(),
                    fieldId: target.fieldId.toString(),
                    field: { type: 'singleLineText', options: {}, updateMode: 'full' },
                  },
                  { allowNoop: true }
                );
                const result = yield* await handler.updateField.handle(batchContext, update);
                events.push(...result.events);
              }
              return ok(new ConvertLinkFieldsToTextResult(events));
            }),
          { scope: 'data', retry: false }
        ),
      { scope: 'meta', retry: false }
    );
  }
}
