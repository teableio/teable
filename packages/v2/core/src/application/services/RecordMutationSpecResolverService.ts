import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import type {
  ICellValueSpec,
  ICellValueSpecVisitor,
} from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import { SetAttachmentValueSpec } from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import { SetLinkValueByTitleSpec } from '../../domain/table/records/specs/values/SetLinkValueByTitleSpec';
import type { SetLinkValueSpec } from '../../domain/table/records/specs/values/SetLinkValueSpec';
import type { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
import { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import { SetUserValueSpec } from '../../domain/table/records/specs/values/SetUserValueSpec';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { AttachmentValueResolverService } from './AttachmentValueResolverService';
import { LinkTitleResolverService } from './LinkTitleResolverService';
import type { ICellValueSpecResolver } from './SpecResolver';
import { UserValueResolverService } from './UserValueResolverService';

class SpecResolutionCollector implements ICellValueSpecVisitor {
  private readonly collected = new Map<ICellValueSpecResolver, ICellValueSpec[]>();

  constructor(private readonly resolvers: ReadonlyArray<ICellValueSpecResolver>) {}

  addSpec(spec: ICellValueSpec): void {
    const resolver = this.resolvers.find((candidate) => candidate.supports(spec));
    if (!resolver) return;
    const list = this.collected.get(resolver) ?? [];
    list.push(spec);
    this.collected.set(resolver, list);
  }

  collectedSpecs(): ReadonlyMap<ICellValueSpecResolver, ReadonlyArray<ICellValueSpec>> {
    return this.collected;
  }

  hasSpecs(): boolean {
    return this.collected.size > 0;
  }

  visitSetSingleLineTextValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetLongTextValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetNumberValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetRatingValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetSingleSelectValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetMultipleSelectValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetCheckboxValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetDateValue(): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetLinkValue(_spec: SetLinkValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetRowOrderValue(_spec: SetRowOrderValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }
  visitSetAttachmentValue(spec: SetAttachmentValueSpec): Result<void, DomainError> {
    this.addSpec(spec);
    return ok(undefined);
  }
  visitSetUserValue(spec: SetUserValueSpec): Result<void, DomainError> {
    this.addSpec(spec);
    return ok(undefined);
  }
  visitSetUserValueByIdentifier(spec: SetUserValueByIdentifierSpec): Result<void, DomainError> {
    this.addSpec(spec);
    return ok(undefined);
  }
  visitSetLinkValueByTitle(spec: SetLinkValueByTitleSpec): Result<void, DomainError> {
    this.addSpec(spec);
    return ok(undefined);
  }
  visitClearFieldValue(): Result<void, DomainError> {
    return ok(undefined);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visit(_spec: any): Result<void, DomainError> {
    return ok(undefined);
  }

  and(): Result<void, DomainError> {
    return ok(undefined);
  }

  or(): Result<void, DomainError> {
    return ok(undefined);
  }

  not(): Result<void, DomainError> {
    return ok(undefined);
  }
}

@injectable()
export class RecordMutationSpecResolverService {
  private readonly resolvers: ReadonlyArray<ICellValueSpecResolver>;

  constructor(
    @inject(v2CoreTokens.linkTitleResolverService)
    linkTitleResolver: LinkTitleResolverService,
    @inject(v2CoreTokens.attachmentValueResolverService)
    attachmentValueResolver: AttachmentValueResolverService,
    @inject(v2CoreTokens.userValueResolverService)
    userValueResolver: UserValueResolverService
  ) {
    this.resolvers = [linkTitleResolver, attachmentValueResolver, userValueResolver];
  }

  needsResolution(spec: ICellValueSpec): Result<boolean, DomainError> {
    const collector = new SpecResolutionCollector(this.resolvers);
    const acceptResult = spec.accept(collector);
    if (acceptResult.isErr()) return err(acceptResult.error);
    return ok(collector.hasSpecs());
  }

  async resolveAndReplace(
    context: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    const collector = new SpecResolutionCollector(this.resolvers);
    const acceptResult = spec.accept(collector);
    if (acceptResult.isErr()) return err(acceptResult.error);

    const collectedSpecs = collector.collectedSpecs();
    if (collectedSpecs.size === 0) {
      return ok(spec);
    }

    const replacements = new Map<string, ICellValueSpec>();
    for (const [resolver, specs] of collectedSpecs) {
      const result = await resolver.resolveSpecs(context, specs);
      if (result.isErr()) {
        return err(result.error);
      }
      if (result.value.length !== specs.length) {
        return err(
          domainError.unexpected({
            message: 'Resolved specs length mismatch',
            code: 'unexpected.resolver_result_length_mismatch',
          })
        );
      }
      for (let i = 0; i < specs.length; i++) {
        const fieldKey = getFieldKey(specs[i]!);
        if (fieldKey) {
          replacements.set(fieldKey, result.value[i]!);
        }
      }
    }

    return ok(replaceSpecs(spec, replacements));
  }

  async resolveAndReplaceMany(
    context: IExecutionContext,
    specs: ReadonlyArray<ICellValueSpec | null>
  ): Promise<Result<ReadonlyArray<ICellValueSpec | null>, DomainError>> {
    const collectedSpecs = new Map<
      ICellValueSpecResolver,
      { specs: ICellValueSpec[]; owners: number[] }
    >();

    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index];
      if (spec === null) continue;
      const collector = new SpecResolutionCollector(this.resolvers);
      const acceptResult = spec.accept(collector);
      if (acceptResult.isErr()) return err(acceptResult.error);

      for (const [resolver, subSpecs] of collector.collectedSpecs()) {
        const entry = collectedSpecs.get(resolver) ?? { specs: [], owners: [] };
        for (const subSpec of subSpecs) {
          entry.specs.push(subSpec);
          entry.owners.push(index);
        }
        collectedSpecs.set(resolver, entry);
      }
    }

    if (collectedSpecs.size === 0) {
      return ok(specs);
    }

    const perSpecReplacements = specs.map(() => new Map<string, ICellValueSpec>());
    for (const [resolver, batch] of collectedSpecs) {
      const result = await resolver.resolveSpecs(context, batch.specs);
      if (result.isErr()) {
        return err(result.error);
      }
      if (result.value.length !== batch.specs.length) {
        return err(
          domainError.unexpected({
            message: 'Resolved specs length mismatch',
            code: 'unexpected.resolver_result_length_mismatch',
          })
        );
      }
      for (let i = 0; i < batch.specs.length; i++) {
        const fieldKey = getFieldKey(batch.specs[i]!);
        if (!fieldKey) continue;
        const owner = batch.owners[i]!;
        perSpecReplacements[owner]!.set(fieldKey, result.value[i]!);
      }
    }

    const resolvedSpecs: (ICellValueSpec | null)[] = [];
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (spec === null) {
        resolvedSpecs.push(null);
        continue;
      }
      const replacements = perSpecReplacements[i]!;
      resolvedSpecs.push(replacements.size > 0 ? replaceSpecs(spec, replacements) : spec);
    }

    return ok(resolvedSpecs);
  }
}

const replaceSpecs = (
  spec: ICellValueSpec,
  replacements: Map<string, ICellValueSpec>
): ICellValueSpec => {
  if (spec instanceof AndSpec) {
    const left = replaceSpecs(spec.leftSpec() as ICellValueSpec, replacements);
    const right = replaceSpecs(spec.rightSpec() as ICellValueSpec, replacements);
    return new AndSpec(left, right);
  }

  if (
    spec instanceof SetUserValueSpec ||
    spec instanceof SetUserValueByIdentifierSpec ||
    spec instanceof SetAttachmentValueSpec
  ) {
    return replacements.get(spec.fieldId.toString()) ?? spec;
  }

  if (spec instanceof SetLinkValueByTitleSpec) {
    return replacements.get(spec.fieldId.toString()) ?? spec;
  }

  return spec;
};

const getFieldKey = (spec: ICellValueSpec): string | null => {
  if (
    spec instanceof SetUserValueSpec ||
    spec instanceof SetUserValueByIdentifierSpec ||
    spec instanceof SetAttachmentValueSpec ||
    spec instanceof SetLinkValueByTitleSpec
  ) {
    return spec.fieldId.toString();
  }
  return null;
};
