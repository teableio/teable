import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldType } from '../../domain/table/fields/FieldType';
import type { ClearFieldValueSpec } from '../../domain/table/records/specs/values/ClearFieldValueSpec';
import type {
  ICellValueSpec,
  ICellValueSpecVisitor,
} from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { SetAttachmentValueSpec } from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import type { SetCheckboxValueSpec } from '../../domain/table/records/specs/values/SetCheckboxValueSpec';
import type { SetDateValueSpec } from '../../domain/table/records/specs/values/SetDateValueSpec';
import { SetLinkValueByTitleSpec } from '../../domain/table/records/specs/values/SetLinkValueByTitleSpec';
import {
  SetLinkValueSpec,
  type LinkItem,
} from '../../domain/table/records/specs/values/SetLinkValueSpec';
import type { SetLongTextValueSpec } from '../../domain/table/records/specs/values/SetLongTextValueSpec';
import type { SetMultipleSelectValueSpec } from '../../domain/table/records/specs/values/SetMultipleSelectValueSpec';
import type { SetNumberValueSpec } from '../../domain/table/records/specs/values/SetNumberValueSpec';
import type { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
import type { SetRatingValueSpec } from '../../domain/table/records/specs/values/SetRatingValueSpec';
import type { SetSingleLineTextValueSpec } from '../../domain/table/records/specs/values/SetSingleLineTextValueSpec';
import type { SetSingleSelectValueSpec } from '../../domain/table/records/specs/values/SetSingleSelectValueSpec';
import type { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import type { SetUserValueSpec } from '../../domain/table/records/specs/values/SetUserValueSpec';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import { CellValue } from '../../domain/table/records/values/CellValue';
import { TableByIdSpec } from '../../domain/table/specs/TableByIdSpec';
import type { Table } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../../ports/TableRecordQueryRepository';
import * as TableRepositoryPort from '../../ports/TableRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type { ICellValueSpecResolver } from './SpecResolver';

/**
 * Input for resolving link titles to record IDs.
 */
export interface LinkTitleResolveRequest {
  readonly fieldId: FieldId;
  readonly foreignTableId: TableId;
  readonly titles: ReadonlyArray<string>;
}

/**
 * Result of resolving link titles to record IDs.
 */
export interface LinkTitleResolveResult {
  readonly fieldId: FieldId;
  readonly resolvedIds: ReadonlyArray<{ id: string; title: string }>;
}

/**
 * Visitor that collects SetLinkValueByTitleSpec instances from a cell value spec.
 */
class LinkTitleCollectorVisitor implements ICellValueSpecVisitor {
  private readonly collected: SetLinkValueByTitleSpec[] = [];

  getCollected(): ReadonlyArray<SetLinkValueByTitleSpec> {
    return this.collected;
  }

  visitSetSingleLineTextValue(_spec: SetSingleLineTextValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLongTextValue(_spec: SetLongTextValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetNumberValue(_spec: SetNumberValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetRatingValue(_spec: SetRatingValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetSingleSelectValue(_spec: SetSingleSelectValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetMultipleSelectValue(_spec: SetMultipleSelectValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetCheckboxValue(_spec: SetCheckboxValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetDateValue(_spec: SetDateValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetAttachmentValue(_spec: SetAttachmentValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValue(_spec: SetUserValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetUserValueByIdentifier(_spec: SetUserValueByIdentifierSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLinkValue(_spec: SetLinkValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetRowOrderValue(_spec: SetRowOrderValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitClearFieldValue(_spec: ClearFieldValueSpec): Result<void, DomainError> {
    return ok(undefined);
  }

  visitSetLinkValueByTitle(spec: SetLinkValueByTitleSpec): Result<void, DomainError> {
    this.collected.push(spec);
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

/**
 * Service that resolves link field titles to record IDs.
 *
 * This service is used in typecast mode when users provide record titles
 * instead of record IDs for link fields. It queries the foreign table's
 * primary field to find matching record IDs.
 *
 * @example
 * ```typescript
 * const resolver = container.get(LinkTitleResolverService);
 * const result = await resolver.resolve(context, baseId, [
 *   { fieldId, foreignTableId, titles: ['Project A', 'Project B'] }
 * ]);
 * // Returns: [{ fieldId, resolvedIds: [{ id: 'recXxx', title: 'Project A' }, ...] }]
 * ```
 */
@injectable()
export class LinkTitleResolverService implements ICellValueSpecResolver<SetLinkValueByTitleSpec> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly recordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository
  ) {}

  /**
   * Extract SetLinkValueByTitleSpec instances from a cell value spec.
   */
  extractLinkTitleSpecs(
    spec: ICellValueSpec
  ): Result<ReadonlyArray<SetLinkValueByTitleSpec>, DomainError> {
    const visitor = new LinkTitleCollectorVisitor();
    const acceptResult = spec.accept(visitor);
    if (acceptResult.isErr()) {
      return err(acceptResult.error);
    }
    return ok(visitor.getCollected());
  }

  /**
   * Resolve link titles to record IDs by querying foreign tables.
   *
   * @param context - Execution context
   * @param requests - Array of resolve requests (fieldId, foreignTableId, titles)
   * @returns Array of resolve results aligned to the input order
   */
  async resolve(
    context: IExecutionContext,
    requests: ReadonlyArray<LinkTitleResolveRequest>
  ): Promise<Result<ReadonlyArray<LinkTitleResolveResult>, DomainError>> {
    const service = this;

    return safeTry<ReadonlyArray<LinkTitleResolveResult>, DomainError>(async function* () {
      if (requests.length === 0) {
        return ok([]);
      }

      const results: LinkTitleResolveResult[] = new Array(requests.length);

      // Group requests by foreign table ID for efficiency
      const byForeignTable = new Map<
        string,
        Array<{ index: number; request: LinkTitleResolveRequest }>
      >();
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i]!;
        const tableIdStr = request.foreignTableId.toString();
        const existing = byForeignTable.get(tableIdStr) ?? [];
        existing.push({ index: i, request });
        byForeignTable.set(tableIdStr, existing);
      }

      // Process each foreign table
      for (const [foreignTableIdStr, tableRequests] of byForeignTable) {
        // Load the foreign table
        const foreignTableId = tableRequests[0]!.request.foreignTableId;
        const foreignTableResult = yield* await service.loadForeignTable(context, foreignTableId);

        // Get primary field for title matching
        const primaryFieldId = foreignTableResult.primaryFieldId();
        const primaryFieldResult = foreignTableResult.getField((f) =>
          f.id().equals(primaryFieldId)
        );
        if (primaryFieldResult.isErr()) {
          return err(
            domainError.notFound({
              message: `Primary field not found in foreign table ${foreignTableIdStr}`,
            })
          );
        }

        // Collect all unique titles for this table
        const allTitles = new Set<string>();
        for (const entry of tableRequests) {
          for (const title of entry.request.titles) {
            allTitles.add(title);
          }
        }

        if (allTitles.size === 0) {
          // No titles to resolve, set empty results
          for (const entry of tableRequests) {
            results[entry.index] = {
              fieldId: entry.request.fieldId,
              resolvedIds: [],
            };
          }
          continue;
        }

        // Query records with matching titles
        const titleToId = yield* await service.queryRecordsByTitles(
          context,
          foreignTableResult,
          primaryFieldId,
          [...allTitles]
        );

        // Build results for each request
        for (const entry of tableRequests) {
          const resolvedIds: Array<{ id: string; title: string }> = [];
          for (const title of entry.request.titles) {
            const recordId = titleToId.get(title);
            if (recordId) {
              resolvedIds.push({ id: recordId, title });
            }
            // If title not found, skip it (typecast mode ignores missing)
          }
          results[entry.index] = {
            fieldId: entry.request.fieldId,
            resolvedIds,
          };
        }
      }

      return ok(results);
    });
  }

  /**
   * Check if a spec contains any SetLinkValueByTitleSpec that needs resolution.
   */
  needsResolution(spec: ICellValueSpec): boolean {
    const extractResult = this.extractLinkTitleSpecs(spec);
    if (extractResult.isErr()) return false;
    return extractResult.value.some((s) => s.titles.length > 0);
  }

  supports(spec: ICellValueSpec): spec is SetLinkValueByTitleSpec {
    return spec instanceof SetLinkValueByTitleSpec;
  }

  async resolveSpecs(
    context: IExecutionContext,
    specs: ReadonlyArray<SetLinkValueByTitleSpec>
  ): Promise<Result<ReadonlyArray<ICellValueSpec>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<ICellValueSpec>, DomainError>(async function* () {
      if (specs.length === 0) {
        return ok([]);
      }

      const requestEntries: Array<{ specIndex: number; request: LinkTitleResolveRequest }> = [];
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]!;
        if (spec.titles.length === 0) continue;
        requestEntries.push({
          specIndex: i,
          request: {
            fieldId: spec.fieldId,
            foreignTableId: spec.foreignTableId,
            titles: spec.titles,
          },
        });
      }

      const resolvedList =
        requestEntries.length > 0
          ? yield* await service.resolve(
              context,
              requestEntries.map((entry) => entry.request)
            )
          : [];

      const resolvedBySpecIndex: Array<LinkTitleResolveResult | undefined> = new Array(
        specs.length
      );
      for (let i = 0; i < requestEntries.length; i++) {
        const entry = requestEntries[i]!;
        resolvedBySpecIndex[entry.specIndex] = resolvedList[i];
      }

      const replacements: ICellValueSpec[] = [];
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]!;
        const resolved = resolvedBySpecIndex[i];
        if (!resolved || resolved.resolvedIds.length === 0) {
          replacements.push(
            new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated<LinkItem[]>(null))
          );
          continue;
        }
        const linkItems: LinkItem[] = resolved.resolvedIds.map((entry) => ({
          id: entry.id,
          title: entry.title,
        }));
        replacements.push(new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated(linkItems)));
      }

      return ok(replacements);
    });
  }

  private async loadForeignTable(
    context: IExecutionContext,
    foreignTableId: TableId
  ): Promise<Result<Table, DomainError>> {
    const spec = TableByIdSpec.create(foreignTableId);
    return this.tableRepository.findOne(context, spec);
  }

  private async queryRecordsByTitles(
    context: IExecutionContext,
    table: Table,
    primaryFieldId: FieldId,
    titles: ReadonlyArray<string>
  ): Promise<Result<Map<string, string>, DomainError>> {
    const service = this;

    return safeTry<Map<string, string>, DomainError>(async function* () {
      // Get the primary field for building the condition
      const primaryFieldResult = table.getField((f) => f.id().equals(primaryFieldId));
      if (primaryFieldResult.isErr()) {
        return err(primaryFieldResult.error);
      }
      const primaryField = primaryFieldResult.value;

      // Primary field must be a text field for title matching
      if (!primaryField.type().equals(FieldType.singleLineText())) {
        return err(
          domainError.validation({
            message: 'Primary field must be a single line text field for title resolution',
          })
        );
      }

      // Query all records and filter in memory
      // TODO: Optimize with SQL-level filtering when the repository supports it
      const queryResult = yield* await service.recordQueryRepository.find(
        context,
        table,
        undefined, // No filter - get all records
        { mode: 'stored' }
      );

      // Build title -> recordId map
      const titlesSet = new Set(titles);
      const titleToId = new Map<string, string>();
      for (const record of queryResult.records) {
        const primaryValue = record.fields[primaryFieldId.toString()];
        if (primaryValue !== null && primaryValue !== undefined) {
          const titleStr = String(primaryValue);
          // Only take the first match for each title (in case of duplicates)
          if (titlesSet.has(titleStr) && !titleToId.has(titleStr)) {
            titleToId.set(titleStr, record.id);
          }
        }
      }

      return ok(titleToId);
    });
  }

  /**
   * Resolve link titles in a spec and replace SetLinkValueByTitleSpec with SetLinkValueSpec.
   *
   * This method:
   * 1. Extracts all SetLinkValueByTitleSpec from the spec
   * 2. Resolves titles to record IDs by querying foreign tables
   * 3. Replaces SetLinkValueByTitleSpec with SetLinkValueSpec containing resolved IDs
   *
   * @param context - Execution context
   * @param spec - The spec to process
   * @returns A new spec with all title-based specs replaced with ID-based specs
   */
  async resolveAndReplace(
    context: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    const service = this;

    return safeTry<ICellValueSpec, DomainError>(async function* () {
      // 1. Extract all SetLinkValueByTitleSpec
      const titleSpecs = yield* service.extractLinkTitleSpecs(spec);

      // If no title specs, return original
      if (titleSpecs.length === 0) {
        return ok(spec);
      }

      // 2. Build resolve requests
      const requestEntries: Array<{
        spec: SetLinkValueByTitleSpec;
        request: LinkTitleResolveRequest;
      }> = [];
      for (const titleSpec of titleSpecs) {
        if (titleSpec.titles.length === 0) continue;
        requestEntries.push({
          spec: titleSpec,
          request: {
            fieldId: titleSpec.fieldId,
            foreignTableId: titleSpec.foreignTableId,
            titles: titleSpec.titles,
          },
        });
      }

      // 3. Resolve all titles
      const resolvedList =
        requestEntries.length > 0
          ? yield* await service.resolve(
              context,
              requestEntries.map((entry) => entry.request)
            )
          : [];

      const resolvedBySpec = new Map<SetLinkValueByTitleSpec, LinkTitleResolveResult>();
      for (let i = 0; i < requestEntries.length; i++) {
        resolvedBySpec.set(requestEntries[i]!.spec, resolvedList[i]!);
      }

      // 4. Replace specs recursively
      return ok(replaceSpecs(spec, resolvedBySpec));
    });
  }
}

/**
 * Recursively replace SetLinkValueByTitleSpec with SetLinkValueSpec in a spec tree.
 */
function replaceSpecs(
  spec: ICellValueSpec,
  resolvedMap: Map<SetLinkValueByTitleSpec, LinkTitleResolveResult>
): ICellValueSpec {
  // Check if this is an AndSpec
  if (spec instanceof AndSpec) {
    const left = replaceSpecs(spec.leftSpec() as ICellValueSpec, resolvedMap);
    const right = replaceSpecs(spec.rightSpec() as ICellValueSpec, resolvedMap);
    return new AndSpec<TableRecord, ICellValueSpecVisitor>(left, right);
  }

  // Check if this is a SetLinkValueByTitleSpec
  if (spec instanceof SetLinkValueByTitleSpec) {
    const resolved = resolvedMap.get(spec);

    // If no titles or empty result, create empty link value
    if (!resolved || resolved.resolvedIds.length === 0) {
      return new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated<LinkItem[]>(null));
    }

    // Create SetLinkValueSpec with resolved IDs
    const linkItems: LinkItem[] = resolved.resolvedIds.map((r) => ({
      id: r.id,
      title: r.title,
    }));
    return new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated(linkItems));
  }

  // Return other specs unchanged
  return spec;
}
