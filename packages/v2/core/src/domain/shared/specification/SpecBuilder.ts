/* eslint-disable @typescript-eslint/naming-convention */
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { AndSpec } from './AndSpec';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';
import { NotSpec } from './NotSpec';
import { OrSpec } from './OrSpec';

export type SpecBuilderMode = 'and' | 'or';

export abstract class SpecBuilder<T, V extends ISpecVisitor, B extends SpecBuilder<T, V, B>> {
  protected readonly specs: Array<ISpecification<T, V>> = [];
  protected readonly errors: string[] = [];
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
      (error) => this.errors.push(error)
    );
  }

  protected recordError(message: string): void {
    this.errors.push(message);
  }

  protected buildFrom(
    specs: ReadonlyArray<ISpecification<T, V>>
  ): Result<ISpecification<T, V>, string> {
    if (this.errors.length > 0) return err(this.errors.join('; '));
    if (specs.length === 0) return err('Empty specification');
    if (specs.length === 1) return ok(specs[0]);

    const [first, ...rest] = specs;
    const combined = rest.reduce<ISpecification<T, V>>(
      (acc, next) => (this.mode === 'and' ? new AndSpec(acc, next) : new OrSpec(acc, next)),
      first
    );
    return ok(combined);
  }

  build(): Result<ISpecification<T, V>, string> {
    return this.buildFrom(this.specs);
  }

  protected abstract createChild(mode: SpecBuilderMode): B;
}
