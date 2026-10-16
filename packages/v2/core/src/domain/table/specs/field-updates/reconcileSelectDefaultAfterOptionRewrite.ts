import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { SelectDefaultValue } from '../../fields/types/SelectDefaultValue';
import { SelectOption } from '../../fields/types/SelectOption';

/**
 * N-27: an option rewrite that does not itself change the default keeps that
 * default attached to the same option.
 *
 * A renamed option's name follows. A deleted option is dropped. If nothing
 * remains, the default is cleared (`undefined`, never an empty array). An
 * explicit default change is applied by the caller and is not reconciled here.
 */
export const reconcileSelectDefaultAfterOptionRewrite = (
  previousOptions: ReadonlyArray<SelectOption>,
  nextOptions: ReadonlyArray<SelectOption>,
  currentDefault: SelectDefaultValue | undefined
): Result<SelectDefaultValue | undefined, DomainError> => {
  if (!currentDefault) return ok(undefined);

  const nextById = new Map(nextOptions.map((option) => [option.id().toString(), option]));
  const previousByName = new Map(
    previousOptions.map((option) => [option.name().toString(), option])
  );

  const raw = currentDefault.toDto();
  const names = Array.isArray(raw) ? raw : [raw];
  const reconciled: string[] = [];

  for (const name of names) {
    const previous = previousByName.get(name);
    if (!previous) {
      if (nextOptions.some((option) => option.name().toString() === name)) {
        reconciled.push(name);
      }
      continue;
    }

    const next = nextById.get(previous.id().toString());
    if (!next) continue;
    reconciled.push(next.name().toString());
  }

  if (reconciled.length === 0) return ok(undefined);
  if (currentDefault.isMultiple()) return SelectDefaultValue.create(reconciled);
  return SelectDefaultValue.create(reconciled[0]);
};

/**
 * Choice ids are optional on update. A payload that resubmits the same names
 * without ids would otherwise mint new ids and look like a delete-and-add,
 * which drops a default that still names a live choice. Reattach a unique
 * unclaimed previous id only for those omitted ids. An explicit new id is a
 * caller-supplied identity and must not be rewritten back to the old one.
 */
export const adoptPreviousSelectOptionIds = (
  previousOptions: ReadonlyArray<SelectOption>,
  nextOptions: ReadonlyArray<SelectOption>,
  omittedIdIndexes: ReadonlySet<number>
): ReadonlyArray<SelectOption> => {
  if (omittedIdIndexes.size === 0) return nextOptions;

  const previousIds = new Set(previousOptions.map((option) => option.id().toString()));
  const claimedIds = new Set(
    nextOptions.map((option) => option.id().toString()).filter((id) => previousIds.has(id))
  );
  const unclaimedByName = new Map<string, SelectOption>();
  const ambiguousNames = new Set<string>();
  for (const option of previousOptions) {
    if (claimedIds.has(option.id().toString())) continue;
    const name = option.name().toString();
    if (unclaimedByName.has(name) || ambiguousNames.has(name)) {
      unclaimedByName.delete(name);
      ambiguousNames.add(name);
      continue;
    }
    unclaimedByName.set(name, option);
  }

  return nextOptions.map((option, index) => {
    if (!omittedIdIndexes.has(index) || previousIds.has(option.id().toString())) return option;
    const previous = unclaimedByName.get(option.name().toString());
    if (!previous) return option;
    unclaimedByName.delete(option.name().toString());
    const adopted = SelectOption.create({
      id: previous.id().toString(),
      name: option.name().toString(),
      color: option.color().toString(),
    });
    return adopted.isOk() ? adopted.value : option;
  });
};
