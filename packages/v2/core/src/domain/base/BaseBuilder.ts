import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../shared/DomainError';
import type { Base } from './Base';
import { BaseId } from './BaseId';
import type { BaseName } from './BaseName';

export interface IBaseBuildProps {
  id: BaseId;
  name: BaseName;
}

export type IBaseFactory = (props: IBaseBuildProps) => Base;

export class BaseBuilder {
  private baseId: BaseId | undefined;
  private baseName: BaseName | undefined;

  private constructor(private readonly factory: IBaseFactory) {}

  static create(factory: IBaseFactory): BaseBuilder {
    return new BaseBuilder(factory);
  }

  withId(id: BaseId): BaseBuilder {
    this.baseId = id;
    return this;
  }

  withName(name: BaseName): BaseBuilder {
    this.baseName = name;
    return this;
  }

  build(): Result<Base, DomainError> {
    return this.ensureBaseId().map((id) => {
      const name = this.baseName!;
      return this.factory({ id, name });
    });
  }

  private ensureBaseId(): Result<BaseId, DomainError> {
    if (this.baseId) return ok(this.baseId);
    return BaseId.generate().map((id) => {
      this.baseId = id;
      return id;
    });
  }
}
