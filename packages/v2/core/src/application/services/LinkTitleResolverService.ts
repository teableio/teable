import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { OrSpec } from '../../domain/shared/specification/OrSpec';
import type { Field } from '../../domain/table/fields/Field';
import type { FieldId } from '../../domain/table/fields/FieldId';
import { FieldType } from '../../domain/table/fields/FieldType';
import { CellValueMultiplicity } from '../../domain/table/fields/types/CellValueMultiplicity';
import { CellValueType } from '../../domain/table/fields/types/CellValueType';
import { NumberField } from '../../domain/table/fields/types/NumberField';
import { NumberFormattingType } from '../../domain/table/fields/types/NumberFormatting';
import type { SingleSelectField } from '../../domain/table/fields/types/SingleSelectField';
import { FieldValueTypeVisitor } from '../../domain/table/fields/visitors/FieldValueTypeVisitor';
import { titleKeyForPrimaryField } from '../../domain/table/fields/visitors/normalizeSingleLineTextCellValue';
import { RecordId } from '../../domain/table/records/RecordId';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import { RecordByIdsSpec } from '../../domain/table/records/specs/RecordByIdsSpec';
import { RecordConditionLiteralValue } from '../../domain/table/records/specs/RecordConditionValues';
import type { ClearFieldValueSpec } from '../../domain/table/records/specs/values/ClearFieldValueSpec';
import type {
  ICellValueSpec,
  ICellValueSpecVisitor,
} from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { SetAttachmentValueSpec } from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import type { SetButtonValueSpec } from '../../domain/table/records/specs/values/SetButtonValueSpec';
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

/** A caller-owned scoped read, used when resolving cells without a record write. */
export type LinkTitleRecordReader = (
  context: IExecutionContext,
  table: Table,
  titleField: Field,
  spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
  recordIds?: ReadonlyArray<string>
) => Promise<Result<TableRecordQueryRepositoryPort.ITableRecordQueryResult, DomainError>>;

export interface LinkTitleResolveRequest {
  readonly fieldId: FieldId;
  readonly foreignTableId: TableId;
  /** Link display field. Defaults to the foreign primary field when absent. */
  readonly lookupFieldId?: FieldId;
  readonly titles: ReadonlyArray<string>;
  /** Interpret generated IDs and existing legacy IDs in a typecast string list. */
  readonly resolveRecordIds?: boolean;
}

export interface LinkTitleResolveResult {
  readonly fieldId: FieldId;
  readonly resolvedIds: LinkItem[];
}

type TitleNormalization = {
  readonly keyByTitle: ReadonlyMap<string, string>;
  readonly matchOrderByTitle: ReadonlyMap<string, number>;
};

type TitleLookupResult = {
  readonly idsByTitle: ReadonlyMap<string, string>;
  readonly normalization?: TitleNormalization;
};

const emptyTitleLookup: TitleLookupResult = { idsByTitle: new Map() };

function findCellFallbackTitles(
  titles: ReadonlyArray<string>,
  normalization: TitleNormalization,
  idMatches: ReadonlyMap<string, LinkItem> | undefined
): ReadonlyMap<string, string> | undefined {
  let fallbacks: Map<string, string> | undefined;
  for (const title of titles) {
    if (idMatches?.has(title)) continue;
    const key = normalization.keyByTitle.get(title);
    if (!key || key === title) continue;
    const order = normalization.matchOrderByTitle.get(title);
    if (order === undefined) continue;

    // Only the canonical spelling and exact legacy spellings from this cell
    // are eligible. Keep the first match returned by the repository.
    const previousTitle = fallbacks?.get(key) ?? key;
    const previousOrder = normalization.matchOrderByTitle.get(previousTitle);
    if (previousOrder === undefined || order < previousOrder) {
      (fallbacks ??= new Map()).set(key, title);
    }
  }
  return fallbacks;
}

const LINK_ID_LOOKUP_BATCH_SIZE = 500;
// Bound the depth of the SQL disjunction and its number of parameters.
const LINK_TITLE_LOOKUP_BATCH_SIZE = 250;

/** Match round(float8::numeric, precision)::text in the link title fill. */
const formatCurrencyTitleNumber = (value: number, precision: number): string => {
  if (!Number.isFinite(value)) return String(value);

  // PostgreSQL casts float8 with %.15g before applying decimal rounding.
  const magnitude = Math.abs(value);
  const [mantissa, power] = magnitude.toExponential(14).split('e');
  let digits = mantissa!.replace('.', '');
  const exponent = Number(power);
  const scaledWidth = exponent + 1 + precision;

  // %.15g uses ties-to-even, while toExponential rounds an exact tie up.
  // For exponents above 16, a 16-digit decimal midpoint cannot fit in float8.
  if (
    scaledWidth >= 0 &&
    exponent <= 16 &&
    Number(digits.at(-1)) % 2 === 1 &&
    /^50+e/.test(magnitude.toExponential(100).slice(16))
  ) {
    digits = String(Number(digits) - 1);
  }

  let units = '0';
  if (scaledWidth >= digits.length) {
    units = digits.padEnd(scaledWidth, '0');
  } else if (scaledWidth >= 0) {
    const truncated = Number(digits.slice(0, scaledWidth));
    units = String(truncated + (digits[scaledWidth]! >= '5' ? 1 : 0));
  }

  const sign = value < 0 && units !== '0' ? '-' : '';
  if (precision === 0) return `${sign}${units}`;
  const fixed = units.padStart(precision + 1, '0');
  return `${sign}${fixed.slice(0, -precision)}.${fixed.slice(-precision)}`;
};

/**
 * Comparable numeric form of a pasted title or a stored numeric cell value.
 * Display formatting (currency, thousands separators, decimals) is not parsed.
 */
const numericTitleValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

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
  visitSetButtonValue(_spec: SetButtonValueSpec): Result<void, DomainError> {
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
    requests: ReadonlyArray<LinkTitleResolveRequest>,
    readRecords?: LinkTitleRecordReader,
    loadTable?: (tableId: TableId) => Promise<Result<Table, DomainError>>
  ): Promise<Result<ReadonlyArray<LinkTitleResolveResult>, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

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
        const foreignTable = yield* await (loadTable
          ? loadTable(foreignTableId)
          : service.loadForeignTable(context, foreignTableId));
        const primaryFieldId = foreignTable.primaryFieldId();

        // Different link fields into the same table may display different
        // columns; group so each group resolves against its own display field.
        const byTitleField = new Map<
          string,
          Array<{
            index: number;
            request: LinkTitleResolveRequest;
            titleFieldId: FieldId;
          }>
        >();
        for (const entry of tableRequests) {
          const titleFieldId = entry.request.lookupFieldId ?? primaryFieldId;
          const titleFieldKey = titleFieldId.toString();
          const existing = byTitleField.get(titleFieldKey) ?? [];
          existing.push({ ...entry, titleFieldId });
          byTitleField.set(titleFieldKey, existing);
        }

        for (const [titleFieldKey, fieldRequests] of byTitleField) {
          const titleFieldId = fieldRequests[0]!.titleFieldId;
          const titleFieldResult = foreignTable.getField((field) =>
            field.id().equals(titleFieldId)
          );
          if (titleFieldResult.isErr()) {
            return err(
              domainError.notFound({
                message: `Title field ${titleFieldKey} not found in foreign table ${foreignTableIdStr}`,
              })
            );
          }
          const titleField = titleFieldResult.value;

          // An existing record takes precedence over a title with the same text.
          // Unmatched generated IDs still use the normal ID write path.
          let candidateIds: Map<string, RecordId> | undefined;
          for (const { request } of fieldRequests) {
            if (!request.resolveRecordIds) continue;
            for (const token of request.titles) {
              if (!token.startsWith('rec') || candidateIds?.has(token)) continue;
              const id = RecordId.forLookup(token);
              if (id.isOk()) (candidateIds ??= new Map()).set(token, id.value);
            }
          }
          let linksById: Map<string, LinkItem> | undefined;
          if (candidateIds) {
            linksById = new Map();
            const formatting =
              !readRecords && titleField instanceof NumberField
                ? titleField.formatting()
                : undefined;
            const currency =
              formatting?.type() === NumberFormattingType.Currency ? formatting : undefined;
            const currencyPrecision = currency?.precision().toNumber();
            const currencySymbol = currency?.symbol() ?? '';
            const ids = [...candidateIds.values()];
            for (let offset = 0; offset < ids.length; offset += LINK_ID_LOOKUP_BATCH_SIZE) {
              const batch = ids.slice(offset, offset + LINK_ID_LOOKUP_BATCH_SIZE);
              const spec = RecordByIdsSpec.create(batch);
              const matches = yield* await (readRecords
                ? readRecords(context, foreignTable, titleField, spec, batch.map(String))
                : service.recordQueryRepository.find(context, foreignTable, spec, {
                    mode: 'stored',
                    projectionFieldIds: [titleFieldId],
                    includeTotal: false,
                  }));
              for (const { id, fields } of matches.records) {
                const title = fields[titleFieldKey];
                if (currencyPrecision !== undefined && typeof title === 'number') {
                  linksById.set(id, {
                    id,
                    title: `${currencySymbol}${formatCurrencyTitleNumber(title, currencyPrecision)}`,
                  });
                  continue;
                }
                linksById.set(
                  id,
                  typeof title === 'string' ||
                    typeof title === 'number' ||
                    typeof title === 'boolean'
                    ? { id, title: String(title) }
                    : { id }
                );
              }
            }
          }

          const allTitles = new Set<string>();
          for (const entry of fieldRequests) {
            for (const title of entry.request.titles) {
              if (title && !(entry.request.resolveRecordIds && linksById?.has(title))) {
                allTitles.add(title);
              }
            }
          }

          const titleLookup = yield* await service.queryRecordsByTitles(
            context,
            foreignTable,
            titleField,
            allTitles,
            readRecords
          );

          for (const entry of fieldRequests) {
            const idMatches = entry.request.resolveRecordIds ? linksById : undefined;
            const { idsByTitle, normalization } = titleLookup;
            const fallbacks =
              normalization && entry.request.titles.length > 1
                ? findCellFallbackTitles(entry.request.titles, normalization, idMatches)
                : undefined;
            const resolvedIds: LinkItem[] = [];
            for (const title of entry.request.titles) {
              const link = idMatches?.get(title);
              if (link) {
                resolvedIds.push(link);
                continue;
              }
              let recordId = idsByTitle.get(title);
              if (recordId === undefined) {
                const key = normalization?.keyByTitle.get(title);
                if (key) recordId = idsByTitle.get(fallbacks?.get(key) ?? key);
              }
              if (recordId) {
                resolvedIds.push({ id: recordId, title });
              } else if (entry.request.resolveRecordIds && RecordId.isCanonical(title)) {
                resolvedIds.push({ id: title });
              }
            }
            results[entry.index] = {
              fieldId: entry.request.fieldId,
              resolvedIds,
            };
          }
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
    titleField: Field,
    titles: ReadonlySet<string>,
    readRecords?: LinkTitleRecordReader
  ): Promise<Result<TitleLookupResult, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

    return safeTry<TitleLookupResult, DomainError>(async function* () {
      if (titles.size === 0) return ok(emptyTitleLookup);
      const valueTypeResult = titleField.accept(new FieldValueTypeVisitor());
      if (valueTypeResult.isErr()) {
        return err(valueTypeResult.error);
      }
      const { cellValueType, isMultipleCellValue } = valueTypeResult.value;
      const fieldType = titleField.type();

      // The read model renders a checkbox display column with the foreign
      // primary title (v1 parity), so resolution must follow that fallback.
      if (fieldType.equals(FieldType.checkbox())) {
        const primaryFieldId = table.primaryFieldId();
        if (!primaryFieldId.equals(titleField.id())) {
          const primaryFieldResult = table.getField((field) => field.id().equals(primaryFieldId));
          if (primaryFieldResult.isErr()) {
            return err(primaryFieldResult.error);
          }
          const resolved = yield* await service.queryRecordsByTitles(
            context,
            table,
            primaryFieldResult.value,
            titles,
            readRecords
          );
          return ok(resolved);
        }
      }

      // A multi-value or non-text display column cannot be compared against a
      // single pasted token; leave those titles unresolved instead of failing
      // the surrounding write.
      if (!isMultipleCellValue.equals(CellValueMultiplicity.single())) {
        return ok(emptyTitleLookup);
      }
      if (
        fieldType.equals(FieldType.user()) ||
        fieldType.equals(FieldType.createdBy()) ||
        fieldType.equals(FieldType.lastModifiedBy())
      ) {
        return ok(emptyTitleLookup);
      }

      if (cellValueType.equals(CellValueType.number())) {
        const requestedNumbers = new Map<string, number>();
        const queryValues = new Set<number>();
        for (const title of titles) {
          const value = numericTitleValue(title);
          if (value === null) continue;
          requestedNumbers.set(title, value);
          queryValues.add(value);
        }
        if (queryValues.size === 0) {
          return ok(emptyTitleLookup);
        }

        const valueToId = new Map<string, string>();
        yield* await service.forEachTitleMatch(
          context,
          table,
          titleField,
          queryValues,
          readRecords,
          (id, value) => {
            const stored = numericTitleValue(value);
            if (stored === null) return;
            const key = String(stored);
            if (!valueToId.has(key)) valueToId.set(key, id);
          }
        );

        const titleToId = new Map<string, string>();
        for (const [title, value] of requestedNumbers) {
          const recordId = valueToId.get(String(value));
          if (recordId) titleToId.set(title, recordId);
        }
        return ok({ idsByTitle: titleToId });
      }

      if (!cellValueType.equals(CellValueType.string())) {
        return ok(emptyTitleLookup);
      }

      if (fieldType.equals(FieldType.singleSelect())) {
        // Select cells may store the choice name or its id depending on the
        // write path; query and compare both forms of the displayed option.
        const optionByName = new Map<string, { id: string; name: string }>();
        const optionIds = new Set<string>();
        for (const option of (titleField as SingleSelectField).selectOptions()) {
          const optionId = option.id().toString();
          const optionName = option.name().toString();
          optionByName.set(optionName, { id: optionId, name: optionName });
          optionIds.add(optionId);
        }

        const titleToKeys = new Map<string, string[]>();
        const queryValues = new Set<string>();
        for (const title of titles) {
          if (!title) continue;
          const option = optionByName.get(title) ?? optionByName.get(title.trim());
          if (option) {
            // v2 stores the choice name; older rows may still hold the id.
            titleToKeys.set(title, [option.name, option.id]);
            queryValues.add(option.name);
            queryValues.add(option.id);
            continue;
          }
          if (optionIds.has(title)) {
            titleToKeys.set(title, [title]);
            queryValues.add(title);
          }
        }
        if (queryValues.size === 0) {
          return ok(emptyTitleLookup);
        }
        const valueToId = new Map<string, string>();
        yield* await service.forEachTitleMatch(
          context,
          table,
          titleField,
          queryValues,
          readRecords,
          (id, value) => {
            if (value == null) return;
            const key = String(value);
            if (!valueToId.has(key)) valueToId.set(key, id);
          }
        );

        const titleToId = new Map<string, string>();
        for (const [title, keys] of titleToKeys) {
          for (const key of keys) {
            const recordId = valueToId.get(key);
            if (recordId) {
              titleToId.set(title, recordId);
              break;
            }
          }
        }
        return ok({ idsByTitle: titleToId });
      }

      const queryTitles = new Set<string>();
      const normalization = fieldType.equals(FieldType.singleLineText())
        ? { keyByTitle: new Map<string, string>(), matchOrderByTitle: new Map<string, number>() }
        : undefined;
      for (const title of titles) {
        if (!title) continue;
        // A nonempty original title stays eligible for an exact match, even when
        // normalization yields nothing (for example a tab-only primary).
        queryTitles.add(title);
        if (normalization) {
          const key = titleKeyForPrimaryField(titleField, title);
          if (key) {
            queryTitles.add(key);
            normalization.keyByTitle.set(title, key);
          }
        }
      }
      if (queryTitles.size === 0) {
        return ok(emptyTitleLookup);
      }

      const exactRecordId = new Map<string, string>();
      yield* await service.forEachTitleMatch(
        context,
        table,
        titleField,
        queryTitles,
        readRecords,
        (id, value) => {
          if (value == null) return;
          const stored = String(value);
          if (exactRecordId.has(stored)) return;
          normalization?.matchOrderByTitle.set(stored, exactRecordId.size);
          exactRecordId.set(stored, id);
        }
      );

      return ok({ idsByTitle: exactRecordId, normalization });
    });
  }

  private async forEachTitleMatch(
    context: IExecutionContext,
    table: Table,
    titleField: Field,
    titles: ReadonlySet<string | number>,
    readRecords: LinkTitleRecordReader | undefined,
    visit: (id: string, value: unknown) => void
  ): Promise<Result<void, DomainError>> {
    const titleFieldKey = titleField.id().toString();
    const readBatch = async (
      spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
    ) => {
      const result = await (readRecords
        ? readRecords(context, table, titleField, spec)
        : this.recordQueryRepository.find(context, table, spec, { mode: 'stored' }));
      return result.map(({ records }) => {
        for (const { id, fields } of records) visit(id, fields[titleFieldKey]);
      });
    };

    return safeTry(async function* () {
      let spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined;
      let size = 0;
      for (const title of titles) {
        if (title === '') continue;
        const value = yield* RecordConditionLiteralValue.create(title);
        const predicate = yield* titleField.spec().create({ operator: 'is', value });
        spec = spec ? new OrSpec(spec, predicate) : predicate;
        if (++size === LINK_TITLE_LOOKUP_BATCH_SIZE) {
          yield* await readBatch(spec);
          spec = undefined;
          size = 0;
        }
      }
      if (spec) yield* await readBatch(spec);
      return ok(undefined);
    });
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
    _tableId: TableId,
    specs: ReadonlyArray<SetLinkValueByTitleSpec>
  ): Promise<Result<ReadonlyArray<ICellValueSpec>, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
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
            lookupFieldId: spec.lookupFieldId,
            titles: spec.titles,
            resolveRecordIds: spec.resolveRecordIds,
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
        replacements.push(toResolvedLinkValueSpec(spec, resolved));
      }

      return ok(replacements);
    });
  }

  async resolveAndReplace(
    context: IExecutionContext,
    spec: ICellValueSpec
  ): Promise<Result<ICellValueSpec, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

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
            lookupFieldId: titleSpec.lookupFieldId,
            titles: titleSpec.titles,
            resolveRecordIds: titleSpec.resolveRecordIds,
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
    return toResolvedLinkValueSpec(spec, resolvedMap.get(spec));
  }

  return spec;
}

function toResolvedLinkValueSpec(
  spec: SetLinkValueByTitleSpec,
  resolved: LinkTitleResolveResult | undefined
): SetLinkValueSpec {
  if (!resolved || resolved.resolvedIds.length === 0) {
    return new SetLinkValueSpec(spec.fieldId, CellValue.fromValidated<LinkItem[]>(null));
  }

  const { resolvedIds: linkItems } = resolved;
  return new SetLinkValueSpec(
    spec.fieldId,
    CellValue.fromValidated(spec.isMultiple ? linkItems : linkItems[0]),
    spec.foreignTableId
  );
}
