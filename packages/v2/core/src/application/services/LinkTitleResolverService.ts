import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import { OrSpec } from '../../domain/shared/specification/OrSpec';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldType } from '../../domain/table/fields/FieldType';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordConditionLiteralValue } from '../../domain/table/records/specs/RecordConditionValues';
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
import type { SetRatingValueSpec } from '../../domain/table/records/specs/values/SetRatingValueSpec';
import type { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
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

export interface LinkTitleResolveRequest {
  readonly fieldId: FieldId;
  readonly foreignTableId: TableId;
  readonly titles: ReadonlyArray<string>;
}

export interface LinkTitleResolveResult {
  readonly fieldId: FieldId;
  readonly resolvedIds: ReadonlyArray<{ id: string; title: string }>;
}

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

@injectable()
export class LinkTitleResolverService implements ICellValueSpecResolver<SetLinkValueByTitleSpec> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly recordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository
  ) {}

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

      for (const [foreignTableIdStr, tableRequests] of byForeignTable) {
        const foreignTableId = tableRequests[0]!.request.foreignTableId;
        const foreignTableResult = yield* await service.loadForeignTable(context, foreignTableId);

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

        const allTitles = new Set<string>();
        for (const entry of tableRequests) {
          for (const title of entry.request.titles) {
            if (title) allTitles.add(title);
          }
        }

        if (allTitles.size === 0) {
          for (const entry of tableRequests) {
            results[entry.index] = {
              fieldId: entry.request.fieldId,
              resolvedIds: [],
            };
          }
          continue;
        }

        const titleToId = yield* await service.queryRecordsByTitles(
          context,
          foreignTableResult,
          primaryFieldId,
          [...allTitles]
        );

        for (const entry of tableRequests) {
          const resolvedIds: Array<{ id: string; title: string }> = [];
          for (const title of entry.request.titles) {
            const recordId = titleToId.get(title);
            if (recordId) {
              resolvedIds.push({ id: recordId, title });
            }
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

  private async loadForeignTable(
    context: IExecutionContext,
    foreignTableId: TableId
  ): Promise<Result<Table, DomainError>> {
    return this.tableRepository.findOne(context, TableByIdSpec.create(foreignTableId));
  }

  private async queryRecordsByTitles(
    context: IExecutionContext,
    table: Table,
    primaryFieldId: FieldId,
    titles: ReadonlyArray<string>
  ): Promise<Result<Map<string, string>, DomainError>> {
    const service = this;

    return safeTry<Map<string, string>, DomainError>(async function* () {
      const primaryFieldResult = table.getField((f) => f.id().equals(primaryFieldId));
      if (primaryFieldResult.isErr()) {
        return err(primaryFieldResult.error);
      }
      const primaryField = primaryFieldResult.value;

      if (!primaryField.type().equals(FieldType.singleLineText())) {
        return err(
          domainError.validation({
            message: 'Primary field must be a single line text field for title resolution',
          })
        );
      }

      const querySpec = yield* service.buildTitleQuerySpec(primaryField, titles);
      const queryResult = yield* await service.recordQueryRepository.find(
        context,
        table,
        querySpec,
        { mode: 'stored' }
      );

      const titlesSet = new Set(titles);
      const titleToId = new Map<string, string>();
      for (const record of queryResult.records) {
        const primaryValue = record.fields[primaryFieldId.toString()];
        if (primaryValue !== null && primaryValue !== undefined) {
          const titleStr = String(primaryValue);
          if (titlesSet.has(titleStr) && !titleToId.has(titleStr)) {
            titleToId.set(titleStr, record.id);
          }
        }
      }

      return ok(titleToId);
    });
  }

  private buildTitleQuerySpec(
    primaryField: Field,
    titles: ReadonlyArray<string>
  ): Result<
    ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    DomainError
  > {
    const uniqueTitles = [...new Set(titles.filter(Boolean))];
    if (uniqueTitles.length === 0) {
      return ok(undefined);
    }

    let querySpec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
    for (const title of uniqueTitles) {
      const titleValue = RecordConditionLiteralValue.create(title);
      if (titleValue.isErr()) {
        return err(titleValue.error);
      }

      const titleSpec = primaryField.spec().create({
        operator: 'is',
        value: titleValue.value,
      });
      if (titleSpec.isErr()) {
        return err(titleSpec.error);
      }

      querySpec = querySpec ? new OrSpec(querySpec, titleSpec.value) : titleSpec.value;
    }

    return ok(querySpec);
  }

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

  async resolveAndReplace(
    context: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    const service = this;

    return safeTry<ICellValueSpec, DomainError>(async function* () {
      const titleSpecs = yield* service.extractLinkTitleSpecs(spec);

      if (titleSpecs.length === 0) {
        return ok(spec);
      }

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

      return ok(replaceSpecs(spec, resolvedBySpec));
    });
  }
}

function replaceSpecs(
  spec: ICellValueSpec,
  resolvedMap: Map<SetLinkValueByTitleSpec, LinkTitleResolveResult>
): ICellValueSpec {
  if (spec instanceof AndSpec) {
    const left = replaceSpecs(spec.leftSpec() as ICellValueSpec, resolvedMap);
    const right = replaceSpecs(spec.rightSpec() as ICellValueSpec, resolvedMap);
    return new AndSpec<TableRecord, ICellValueSpecVisitor>(left, right);
  }

  if (spec instanceof SetLinkValueByTitleSpec) {
    const resolved = resolvedMap.get(spec);

    if (!resolved || resolved.resolvedIds.length === 0) {
      return new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated<LinkItem[]>(null));
    }

    const linkItems: LinkItem[] = resolved.resolvedIds.map((entry) => ({
      id: entry.id,
      title: entry.title,
    }));
    return new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated(linkItems));
  }

  return spec;
}
