import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { Base } from '../domain/base/Base';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import * as BaseRepositoryPort from '../ports/BaseRepository';
import * as EventBusPort from '../ports/EventBus';
import type * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateBaseCommand } from './CreateBaseCommand';

export class CreateBaseResult {
  private constructor(
    readonly base: Base,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(base: Base, events: ReadonlyArray<IDomainEvent>): CreateBaseResult {
    return new CreateBaseResult(base, [...events]);
  }
}

@CommandHandler(CreateBaseCommand)
@injectable()
export class CreateBaseHandler implements ICommandHandler<CreateBaseCommand, CreateBaseResult> {
  constructor(
    @inject(v2CoreTokens.baseRepository)
    private readonly baseRepository: BaseRepositoryPort.IBaseRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus
  ) {}

  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateBaseCommand
  ): Promise<Result<CreateBaseResult, DomainError>> {
    const handler = this;
    return safeTry<CreateBaseResult, DomainError>(async function* () {
      const builder = Base.builder().withName(command.baseName);
      if (command.baseId) {
        builder.withId(command.baseId);
      }

      const base = yield* builder.build();
      const events = base.pullDomainEvents();

      yield* await handler.baseRepository.insert(context, base);

      for (const event of events) {
        await handler.eventBus.publish(context, event);
      }

      return ok(CreateBaseResult.create(base, events));
    });
  }
}
