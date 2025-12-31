/* eslint-disable @typescript-eslint/naming-convention */
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../DomainError';
import { AndSpec } from './AndSpec';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';
import { NotSpec } from './NotSpec';
import { OrSpec } from './OrSpec';

export type SpecBuilderMode = 'and' | 'or';

export abstract class SpecBuilder<T, V extends ISpecVisitor, B extends SpecBuilder<T, V, B>> {
  protected readonly specs: Array<ISpecification<T, V>> = [];
  protected readonly errors: DomainError[] = [];
  protected readonly mode: SpecBuilderMode;

  protected constructor(mode: SpecBuilderMode = 'and') {
    this.mode = mode;
  }

  protected addSpec(spec: ISpecification<T, V>): void {
    this.specs.push(spec);
  }

  protected addNotSpec(spec: ISpecification<T, V>): void {
    this.specs.push(new NotSpec(spec));
  }

  protected addGroup(mode: SpecBuilderMode, build: (builder: B) => B): void {
    const groupBuilder = this.createChild(mode);
    const configured = build(groupBuilder);
    const result = configured.build();
    result.match(
      (spec) => this.addSpec(spec),
      (error) => this.recordError(error)
    );
  }

  protected recordError(error: DomainError | string): void {
    this.errors.push(
      typeof error === 'string' ? domainError.validation({ message: error }) : error
    );
  }

  protected buildFrom(
    specs: ReadonlyArray<ISpecification<T, V>>
  ): Result<ISpecification<T, V>, DomainError> {
    if (this.errors.length > 0) {
      if (this.errors.length === 1) return err(this.errors[0]);
      return err(
        domainError.validation({
          code: 'spec.builder',
          message: 'Specification builder errors',
          details: { errors: this.errors.map((error) => error.message) },
        })
      );
    }
    if (specs.length === 0) return err(domainError.validation({ message: 'Empty specification' }));
    if (specs.length === 1) return ok(specs[0]);

    const [first, ...rest] = specs;
    const combined = rest.reduce<ISpecification<T, V>>(
      (acc, next) => (this.mode === 'and' ? new AndSpec(acc, next) : new OrSpec(acc, next)),
      first
    );
    return ok(combined);
  }

  build(): Result<ISpecification<T, V>, DomainError> {
    return this.buildFrom(this.specs);
  }

  protected abstract createChild(mode: SpecBuilderMode): B;
}
