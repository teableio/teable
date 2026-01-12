import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { AggregateRoot } from '../shared/AggregateRoot';
import type { DomainError } from '../shared/DomainError';
import { BaseBuilder, type IBaseBuildProps } from './BaseBuilder';
import type { BaseId } from './BaseId';
import type { BaseName } from './BaseName';
import { BaseCreated } from './events/BaseCreated';

export class Base extends AggregateRoot<BaseId> {
  private constructor(
    id: BaseId,
    private readonly nameValue: BaseName,
    options: { emitCreatedEvent: boolean }
  ) {
    super(id);

    if (options.emitCreatedEvent) {
      this.addDomainEvent(
        BaseCreated.create({
          baseId: id,
          baseName: nameValue,
        })
      );
    }
  }

  static builder(): BaseBuilder {
    const factory = (props: IBaseBuildProps): Base =>
      new Base(props.id, props.name, { emitCreatedEvent: true });
    return BaseBuilder.create(factory);
  }

  static rehydrate(props: IBaseBuildProps): Result<Base, DomainError> {
    const base = new Base(props.id, props.name, { emitCreatedEvent: false });
    return ok(base);
  }

  name(): BaseName {
    return this.nameValue;
  }
}
