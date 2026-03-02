import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../DomainError';
import { AndSpec } from './AndSpec';
import type { ISpecification } from './ISpecification';
import type { ISpecVisitor } from './ISpecVisitor';

export const composeAndSpecs = <T, V extends ISpecVisitor>(
  specs: ReadonlyArray<ISpecification<T, V>>
): Result<ISpecification<T, V>, DomainError> => {
  if (specs.length === 0) {
    return err(domainError.validation({ message: 'Empty specification' }));
  }
  if (specs.length === 1) {
    return ok(specs[0]!);
  }

  let composed: ISpecification<T, V> = specs[0]!;
  for (let i = 1; i < specs.length; i++) {
    composed = new AndSpec<T, V>(composed, specs[i]!);
  }
  return ok(composed);
};

export const composeAndSpecsOrUndefined = <T, V extends ISpecVisitor>(
  specs: ReadonlyArray<ISpecification<T, V>>
): ISpecification<T, V> | undefined => composeAndSpecs(specs).unwrapOr(undefined);

export const flattenAndSpecs = <T, V extends ISpecVisitor>(
  spec: ISpecification<T, V> | undefined
): ReadonlyArray<ISpecification<T, V>> => {
  if (!spec) {
    return [];
  }
  if (spec instanceof AndSpec) {
    return [...flattenAndSpecs(spec.leftSpec()), ...flattenAndSpecs(spec.rightSpec())];
  }
  return [spec];
};
