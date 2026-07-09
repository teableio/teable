import type { IFieldRo, IViewRo } from '@teable/core';
import {
  Colors,
  DateFormattingPreset,
  FieldType,
  generateFieldId,
  NumberFormattingType,
  RatingIcon,
  SingleLineTextDisplayType,
  TimeFormatting,
  ViewType,
} from '@teable/core';
import type { IImportAirtableIssue } from '@teable/openapi';
import { translateAirtableFormula } from './airtable-formula-translator';
import { mapAirtableRollupAggregation } from './airtable-rollup-mapper';
import type { IAirtableFilterGroup, IAirtableRollupSource } from './airtable-share.client';
import type {
  IAirtableField,
  IAirtableFieldOptions,
  IAirtableFieldResult,
  IAirtableTable,
} from './airtable.types';

/** How raw Airtable cell values are converted before writing to Teable. */
export type IAirtableCellConverter =
  | 'string'
  | 'number'
  | 'boolean'
  | 'dateTime'
  | 'stringArray'
  | 'user'
  | 'attachment'
  | 'barcode'
  | 'button'
  | 'aiText'
  | 'collaboratorText'
  | 'snapshotText'
  | 'snapshotNumber'
  | 'snapshotDate'
  | 'snapshotCheckbox';

/** A normalized chunk of an Airtable AI field prompt: plain text or a field reference. */
export interface IAiPromptPart {
  text?: string;
  airtableFieldId?: string;
  fieldName?: string;
}

export interface IPlannedDirectField {
  airtableFieldId: string;
  converter: IAirtableCellConverter;
  ro: IFieldRo;
  /**
   * Present for Airtable aiText fields. The importer turns it into a Teable
   * AI field config when the target base has an AI model configured.
   */
  aiPromptParts?: IAiPromptPart[];
}

export interface IPlannedLinkField {
  airtableFieldId: string;
  teableFieldId: string;
  name: string;
  description?: string;
  airtableForeignTableId: string;
  prefersSingle: boolean;
  /** The paired two-way field in the foreign table, mapped to the auto-created symmetric field. */
  inverse?: { airtableFieldId: string; name: string; prefersSingle: boolean };
  /** Airtable's "limit record selection to a view" — a view id in the foreign table. */
  viewIdForRecordSelection?: string;
}

export interface IPlannedLookupField {
  airtableFieldId: string;
  teableFieldId: string;
  name: string;
  description?: string;
  airtableLinkFieldId: string;
  airtableForeignTableId: string;
  airtableTargetFieldId: string;
}

export interface IPlannedCountField {
  airtableFieldId: string;
  teableFieldId: string;
  name: string;
  description?: string;
  airtableLinkFieldId: string;
  airtableForeignTableId: string;
}

export interface IPlannedFormulaField {
  airtableFieldId: string;
  teableFieldId: string;
  name: string;
  description?: string;
  /** Translated Teable expression, still referencing fields by Airtable id (`{fldXXX}`). */
  expression: string;
}

export interface IPlannedRollupField {
  airtableFieldId: string;
  teableFieldId: string;
  name: string;
  description?: string;
  /** Teable rollup expression, e.g. `sum({values})`. */
  expression: string;
  airtableLinkFieldId: string;
  airtableForeignTableId: string;
  airtableForeignFieldId: string;
  /** Raw Airtable "only include records that meet conditions" filter, mapped at creation. */
  filter: IAirtableFilterGroup | null;
}

/** The Airtable view each created Teable view came from (for view-config import). */
export interface IPlannedViewSource {
  airtableViewId: string;
  teableViewType: ViewType;
}

export interface IAirtableTablePlan {
  airtableTableId: string;
  name: string;
  description?: string;
  /** Phase-1 fields in creation order, primary first. */
  fields: IPlannedDirectField[];
  views: IViewRo[];
  /** Aligned index-wise with `views`; empty entries (default fallback) have no source. */
  viewSources: IPlannedViewSource[];
  /** Phase-2 fields, created after all tables and records exist. */
  linkFields: IPlannedLinkField[];
  lookupFields: IPlannedLookupField[];
  countFields: IPlannedCountField[];
  /** Phase-3 fields, created last so every referenced field id is already mapped. */
  formulaFields: IPlannedFormulaField[];
  /** Live rollups recreated from the shared base model, created with lookups/counts. */
  rollupFields: IPlannedRollupField[];
}

export interface IAirtableImportPlan {
  tables: IAirtableTablePlan[];
  /**
   * airtable field id -> pre-generated teable field id. Table ids cannot be
   * client-specified, the importer records them from the create-table
   * responses. Inverse link fields are mapped during import as well (to the
   * auto-created symmetric fields).
   */
  fieldIdMap: Record<string, string>;
  issues: IImportAirtableIssue[];
}

const maxNumberPrecision = 5;
const maxDescriptionLength = 1000;
const longTextSnapshotLabel = 'longText snapshot';

const teableColorValues = new Set<string>(Object.values(Colors));

/** Rotating palette for select choices when Airtable has colored options disabled. */
const defaultChoiceColors = [
  Colors.BlueLight1,
  Colors.GreenLight1,
  Colors.YellowLight1,
  Colors.OrangeLight1,
  Colors.RedLight1,
  Colors.PurpleLight1,
  Colors.PinkLight1,
  Colors.CyanLight1,
  Colors.TealLight1,
  Colors.GrayLight1,
];

const viewTypeMap: Record<string, ViewType> = {
  grid: ViewType.Grid,
  form: ViewType.Form,
  calendar: ViewType.Calendar,
  gallery: ViewType.Gallery,
  kanban: ViewType.Kanban,
};

const ratingIconMap: Record<string, RatingIcon> = {
  star: RatingIcon.Star,
  heart: RatingIcon.Heart,
  thumbsUp: RatingIcon.ThumbUp,
  flag: RatingIcon.Flame,
  dot: RatingIcon.Moon,
};

const primaryIncompatibleTypes = new Set<FieldType>([FieldType.Attachment, FieldType.Checkbox]);

const clampPrecision = (precision: unknown) => {
  const value = typeof precision === 'number' ? Math.round(precision) : 0;
  return Math.min(Math.max(value, 0), maxNumberPrecision);
};

const mapTimeZone = (timeZone: string | undefined) => {
  if (!timeZone || timeZone === 'client' || timeZone === 'utc') {
    return 'UTC';
  }
  return timeZone;
};

const mapDateFormat = (options: IAirtableFieldOptions | undefined) => {
  switch (options?.dateFormat?.name) {
    case 'us':
      return DateFormattingPreset.US;
    case 'european':
      return DateFormattingPreset.European;
    default:
      return DateFormattingPreset.ISO;
  }
};

const mapTimeFormat = (options: IAirtableFieldOptions | undefined) => {
  switch (options?.timeFormat?.name) {
    case '12hour':
      return TimeFormatting.Hour12;
    case '24hour':
      return TimeFormatting.Hour24;
    default:
      return TimeFormatting.None;
  }
};

const buildDatetimeFormatting = (
  options: IAirtableFieldOptions | undefined,
  withTime: boolean
) => ({
  date: mapDateFormat(options),
  time: withTime ? mapTimeFormat(options) : TimeFormatting.None,
  timeZone: mapTimeZone(options?.timeZone),
});

const mapRatingColor = (color: string | undefined) => {
  if (color === Colors.YellowBright || color === 'orangeBright') {
    return Colors.YellowBright;
  }
  if (color === Colors.RedBright || color === 'pinkBright' || color === 'purpleBright') {
    return Colors.RedBright;
  }
  return Colors.TealBright;
};

const mapSelectChoices = (options: IAirtableFieldOptions | undefined) => {
  const choices = options?.choices ?? [];
  // Airtable identifies choices by id and allows duplicate names (including
  // names differing only by surrounding whitespace). Teable trims option
  // names and requires them to be unique, so duplicates are merged into the
  // first occurrence — record cells only carry the name, so they cannot
  // reference a specific duplicate anyway.
  const seenNames = new Set<string>();
  const mapped: Array<{ name: string; color: Colors }> = [];
  choices.forEach((choice, index) => {
    // Airtable allows blank option names; Teable requires at least one char.
    const name = choice.name?.trim() || `(blank ${index + 1})`;
    if (seenNames.has(name)) return;
    seenNames.add(name);
    mapped.push({
      name,
      color: (teableColorValues.has(choice.color ?? '')
        ? choice.color
        : defaultChoiceColors[index % defaultChoiceColors.length]) as Colors,
    });
  });
  return mapped;
};

const truncateDescription = (description: string) =>
  description.length > maxDescriptionLength
    ? `${description.slice(0, maxDescriptionLength - 1)}…`
    : description;

/** Rewrites `{fldXXX}` references inside a formula to readable `{Field Name}` references. */
const humanizeFormula = (formula: string, fieldNameById: Map<string, string>) =>
  formula.replace(/\{(fld[a-zA-Z0-9]+)\}/g, (match, fieldId: string) => {
    const name = fieldNameById.get(fieldId);
    return name ? `{${name}}` : match;
  });

interface IDirectMapping {
  kind: 'direct';
  type: FieldType;
  options?: IFieldRo['options'];
  converter: IAirtableCellConverter;
  degradedTo?: string;
  aiPromptParts?: IAiPromptPart[];
}

/**
 * Normalizes an Airtable aiText prompt (an array of text chunks and field
 * reference objects) so the importer can rebuild it as a Teable AI prompt.
 */
const normalizeAiPromptParts = (
  prompt: unknown,
  fieldNameById: Map<string, string>
): IAiPromptPart[] => {
  if (!Array.isArray(prompt)) return [];
  const parts: IAiPromptPart[] = [];
  for (const part of prompt) {
    if (typeof part === 'string') {
      parts.push({ text: part });
      continue;
    }
    if (part && typeof part === 'object') {
      const record = part as { field?: { fieldId?: unknown }; fieldId?: unknown };
      const fieldId = record.field?.fieldId ?? record.fieldId;
      if (typeof fieldId === 'string') {
        parts.push({ airtableFieldId: fieldId, fieldName: fieldNameById.get(fieldId) });
      }
    }
  }
  return parts;
};

interface ISkipMapping {
  kind: 'skip';
  reason: string;
}

type IFieldMapping = IDirectMapping | ISkipMapping;

const textMapping = (showAs?: SingleLineTextDisplayType): IDirectMapping => ({
  kind: 'direct',
  type: FieldType.SingleLineText,
  options: showAs ? { showAs: { type: showAs } } : {},
  converter: 'string',
});

const numberMapping = (
  formattingType: NumberFormattingType,
  options: IAirtableFieldOptions | undefined,
  converter: IAirtableCellConverter = 'number'
): IDirectMapping => ({
  kind: 'direct',
  type: FieldType.Number,
  options: {
    formatting: {
      type: formattingType,
      precision: clampPrecision(options?.precision),
      ...(formattingType === NumberFormattingType.Currency
        ? { symbol: options?.symbol ?? '$' }
        : {}),
    },
  },
  converter,
});

/**
 * Maps the `result` config of a computed Airtable field (formula/rollup/lookup)
 * to a plain Teable field that stores a static snapshot of the computed values.
 */
const snapshotMappingFromResult = (
  result: IAirtableFieldResult | null | undefined
): IDirectMapping => {
  const options = result?.options as IAirtableFieldOptions | undefined;
  switch (result?.type) {
    case 'number':
      return numberMapping(NumberFormattingType.Decimal, options, 'snapshotNumber');
    case 'percent':
      return numberMapping(NumberFormattingType.Percent, options, 'snapshotNumber');
    case 'currency':
      return numberMapping(NumberFormattingType.Currency, options, 'snapshotNumber');
    case 'duration':
    case 'rating':
    case 'autoNumber':
    case 'count':
      return {
        kind: 'direct',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: clampPrecision(0) },
        },
        converter: 'snapshotNumber',
      };
    case 'date':
    case 'dateTime':
    case 'createdTime':
    case 'lastModifiedTime':
      return {
        kind: 'direct',
        type: FieldType.Date,
        options: { formatting: buildDatetimeFormatting(options, result.type !== 'date') },
        converter: 'snapshotDate',
      };
    case 'checkbox':
      return {
        kind: 'direct',
        type: FieldType.Checkbox,
        options: {},
        converter: 'snapshotCheckbox',
      };
    default:
      return {
        kind: 'direct',
        type: FieldType.SingleLineText,
        options: {},
        converter: 'snapshotText',
      };
  }
};

// eslint-disable-next-line sonarjs/cognitive-complexity
const mapField = (field: IAirtableField, fieldNameById: Map<string, string>): IFieldMapping => {
  const { type, options } = field;
  switch (type) {
    case 'singleLineText':
      return textMapping();
    case 'email':
      return textMapping(SingleLineTextDisplayType.Email);
    case 'url':
      return textMapping(SingleLineTextDisplayType.Url);
    case 'phoneNumber':
      return textMapping(SingleLineTextDisplayType.Phone);
    case 'multilineText':
    case 'richText':
      return { kind: 'direct', type: FieldType.LongText, options: {}, converter: 'string' };
    case 'number':
      return numberMapping(NumberFormattingType.Decimal, options);
    case 'percent':
      return numberMapping(NumberFormattingType.Percent, options);
    case 'currency':
      return numberMapping(NumberFormattingType.Currency, options);
    case 'duration':
    case 'autoNumber':
      // Teable has no duration type (Airtable stores duration as seconds) and
      // cannot back-fill auto numbers — keep both as plain numbers.
      return {
        ...numberMapping(NumberFormattingType.Decimal, { precision: 0 }),
        degradedTo: 'number',
      };
    case 'rating':
      return {
        kind: 'direct',
        type: FieldType.Rating,
        options: {
          icon: ratingIconMap[options?.icon ?? ''] ?? RatingIcon.Star,
          color: mapRatingColor(options?.color),
          max: Math.min(Math.max(options?.max ?? 5, 1), 10),
        },
        converter: 'number',
      };
    case 'checkbox':
      return { kind: 'direct', type: FieldType.Checkbox, options: {}, converter: 'boolean' };
    case 'singleSelect':
      return {
        kind: 'direct',
        type: FieldType.SingleSelect,
        options: { choices: mapSelectChoices(options) },
        converter: 'string',
      };
    case 'multipleSelects':
      return {
        kind: 'direct',
        type: FieldType.MultipleSelect,
        options: { choices: mapSelectChoices(options) },
        converter: 'stringArray',
      };
    case 'externalSyncSource':
      return {
        kind: 'direct',
        type: FieldType.SingleSelect,
        options: { choices: mapSelectChoices(options) },
        converter: 'string',
        degradedTo: 'singleSelect',
      };
    case 'date':
      return {
        kind: 'direct',
        type: FieldType.Date,
        options: { formatting: buildDatetimeFormatting(options, false) },
        converter: 'dateTime',
      };
    case 'dateTime':
      return {
        kind: 'direct',
        type: FieldType.Date,
        options: { formatting: buildDatetimeFormatting(options, true) },
        converter: 'dateTime',
      };
    case 'createdTime':
    case 'lastModifiedTime': {
      // Teable would recompute these to the import time; keep the original
      // values as a static date snapshot instead.
      const result = options?.result;
      const resultOptions = result?.options as IAirtableFieldOptions | undefined;
      return {
        kind: 'direct',
        type: FieldType.Date,
        options: { formatting: buildDatetimeFormatting(resultOptions, true) },
        converter: 'dateTime',
        degradedTo: 'date snapshot',
      };
    }
    case 'createdBy':
    case 'lastModifiedBy':
      return {
        kind: 'direct',
        type: FieldType.SingleLineText,
        options: {},
        converter: 'collaboratorText',
        degradedTo: 'singleLineText snapshot',
      };
    case 'singleCollaborator':
      return { kind: 'direct', type: FieldType.User, options: {}, converter: 'user' };
    case 'multipleCollaborators':
      return {
        kind: 'direct',
        type: FieldType.User,
        options: { isMultiple: true },
        converter: 'user',
      };
    case 'multipleAttachments':
      return { kind: 'direct', type: FieldType.Attachment, options: {}, converter: 'attachment' };
    case 'barcode':
      return {
        kind: 'direct',
        type: FieldType.SingleLineText,
        options: {},
        converter: 'barcode',
        degradedTo: 'singleLineText',
      };
    case 'button':
      return {
        kind: 'direct',
        type: FieldType.SingleLineText,
        options: {},
        converter: 'button',
        degradedTo: 'singleLineText',
      };
    case 'aiText':
      // Becomes a Teable AI field when the target base has an AI model
      // configured; otherwise the importer reports it as a snapshot.
      return {
        kind: 'direct',
        type: FieldType.LongText,
        options: {},
        converter: 'aiText',
        aiPromptParts: normalizeAiPromptParts(options?.prompt, fieldNameById),
      };
    // formula and rollup are handled in the main loop (translate-or-snapshot).
    default:
      // Unknown / future Airtable field types degrade to a text snapshot so
      // the import never fails on them.
      return {
        kind: 'direct',
        type: FieldType.LongText,
        options: {},
        converter: 'snapshotText',
        degradedTo: longTextSnapshotLabel,
      };
  }
};

const buildComputedDescription = (
  field: IAirtableField,
  fieldNameById: Map<string, string>
): string | undefined => {
  if (field.type === 'formula' && field.options?.formula) {
    const formula = humanizeFormula(field.options.formula, fieldNameById);
    return truncateDescription(`Airtable formula: ${formula}`);
  }
  if (field.type === 'rollup') {
    const linkName = fieldNameById.get(field.options?.recordLinkFieldId ?? '');
    const targetName = fieldNameById.get(field.options?.fieldIdInLinkedTable ?? '');
    if (linkName && targetName) {
      return truncateDescription(`Airtable rollup of "${targetName}" via "${linkName}"`);
    }
  }
  if (field.type === 'multipleLookupValues') {
    const linkName = fieldNameById.get(field.options?.recordLinkFieldId ?? '');
    const targetName = fieldNameById.get(field.options?.fieldIdInLinkedTable ?? '');
    if (linkName && targetName) {
      return truncateDescription(`Airtable lookup of "${targetName}" via "${linkName}"`);
    }
  }
  return field.description ? truncateDescription(field.description) : undefined;
};

const mapViews = (
  table: IAirtableTable,
  issues: IImportAirtableIssue[]
): { views: IViewRo[]; sources: IPlannedViewSource[] } => {
  const views: IViewRo[] = [];
  const sources: IPlannedViewSource[] = [];
  for (const view of table.views) {
    const viewType = viewTypeMap[view.type];
    if (!viewType) {
      issues.push({
        code: 'viewSkipped',
        tableName: table.name,
        viewName: view.name,
        fromType: view.type,
      });
      continue;
    }
    views.push({ name: view.name, type: viewType } as IViewRo);
    sources.push({ airtableViewId: view.id, teableViewType: viewType });
  }
  if (views.length === 0) {
    views.push({ type: ViewType.Grid } as IViewRo);
  }
  return { views, sources };
};

/**
 * Builds the full import plan for an Airtable base schema: phase-1 plain
 * fields (created together with the tables), view shells, and phase-2
 * link/lookup/count fields (created once all tables and records exist).
 */
/* eslint-disable sonarjs/cognitive-complexity -- one large switch over Airtable field types */
export const buildAirtableImportPlan = (
  tables: IAirtableTable[],
  /** Rollup sources from the shared base model; absent when no share link was given. */
  rollupSources?: Map<string, IAirtableRollupSource>
): IAirtableImportPlan => {
  const issues: IImportAirtableIssue[] = [];
  const fieldIdMap: Record<string, string> = {};
  const tableById = new Map(tables.map((table) => [table.id, table]));
  const fieldNameById = new Map<string, string>();
  for (const table of tables) {
    for (const field of table.fields) {
      fieldNameById.set(field.id, field.name);
    }
  }

  // Two-way links appear as a field on both tables; the second one of each
  // pair is realized by renaming the symmetric field Teable auto-creates.
  const inverseFieldIds = new Set<string>();
  for (const table of tables) {
    for (const field of table.fields) {
      if (field.type !== 'multipleRecordLinks' || inverseFieldIds.has(field.id)) {
        continue;
      }
      const inverseId = field.options?.inverseLinkFieldId;
      const foreignTable = tableById.get(field.options?.linkedTableId ?? '');
      const inverseField = foreignTable?.fields.find(
        (candidate) => candidate.id === inverseId && candidate.type === 'multipleRecordLinks'
      );
      if (inverseField && inverseField.id !== field.id) {
        // Own the link from the single-link side so a one-to-many keeps its
        // ManyOne cardinality regardless of table/field traversal order. Only
        // flips when exactly one side prefers a single link; ties (both single
        // or both multi) keep traversal order.
        const fieldSingle = field.options?.prefersSingleRecordLink === true;
        const inverseSingle = inverseField.options?.prefersSingleRecordLink === true;
        const inverseOwns = inverseSingle && !fieldSingle;
        inverseFieldIds.add(inverseOwns ? field.id : inverseField.id);
      }
    }
  }

  const plannedLinkIds = new Set<string>();
  for (const table of tables) {
    for (const field of table.fields) {
      if (
        field.type === 'multipleRecordLinks' &&
        tableById.has(field.options?.linkedTableId ?? '') &&
        !inverseFieldIds.has(field.id)
      ) {
        plannedLinkIds.add(field.id);
      }
    }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const tablePlans: IAirtableTablePlan[] = tables.map((table) => {
    const { views, sources } = mapViews(table, issues);
    const plan: IAirtableTablePlan = {
      airtableTableId: table.id,
      name: table.name,
      description: table.description,
      fields: [],
      views,
      viewSources: sources,
      linkFields: [],
      lookupFields: [],
      countFields: [],
      formulaFields: [],
      rollupFields: [],
    };

    for (const field of table.fields) {
      const description = buildComputedDescription(field, fieldNameById);

      if (field.type === 'multipleRecordLinks') {
        if (inverseFieldIds.has(field.id)) {
          // Realized as the symmetric side of the owning link field.
          continue;
        }
        const foreignTable = tableById.get(field.options?.linkedTableId ?? '');
        if (!foreignTable) {
          issues.push({
            code: 'fieldSkipped',
            tableName: table.name,
            fieldName: field.name,
            fromType: field.type,
            reason: 'linked table not found',
          });
          continue;
        }
        const inverseId = field.options?.inverseLinkFieldId;
        const inverseField = foreignTable.fields.find(
          (candidate) => candidate.id === inverseId && inverseFieldIds.has(candidate.id)
        );
        const teableFieldId = generateFieldId();
        fieldIdMap[field.id] = teableFieldId;
        plan.linkFields.push({
          airtableFieldId: field.id,
          teableFieldId,
          name: field.name,
          description,
          airtableForeignTableId: foreignTable.id,
          prefersSingle: field.options?.prefersSingleRecordLink === true,
          viewIdForRecordSelection: field.options?.viewIdForRecordSelection,
          inverse: inverseField
            ? {
                airtableFieldId: inverseField.id,
                name: inverseField.name,
                prefersSingle: inverseField.options?.prefersSingleRecordLink === true,
              }
            : undefined,
        });
        continue;
      }

      if (field.type === 'count') {
        const linkFieldId = field.options?.recordLinkFieldId ?? '';
        const linkField = table.fields.find((candidate) => candidate.id === linkFieldId);
        const foreignTableId = linkField?.options?.linkedTableId ?? '';
        if (
          field.options?.isValid !== false &&
          (plannedLinkIds.has(linkFieldId) || inverseFieldIds.has(linkFieldId)) &&
          tableById.has(foreignTableId)
        ) {
          const teableFieldId = generateFieldId();
          fieldIdMap[field.id] = teableFieldId;
          plan.countFields.push({
            airtableFieldId: field.id,
            teableFieldId,
            name: field.name,
            description,
            airtableLinkFieldId: linkFieldId,
            airtableForeignTableId: foreignTableId,
          });
          continue;
        }
        const mapping = snapshotMappingFromResult({ type: 'count' });
        issues.push({
          code: 'fieldDegraded',
          tableName: table.name,
          fieldName: field.name,
          fromType: field.type,
          toType: 'number snapshot',
        });
        const teableFieldId = generateFieldId();
        fieldIdMap[field.id] = teableFieldId;
        plan.fields.push({
          airtableFieldId: field.id,
          converter: mapping.converter,
          ro: {
            id: teableFieldId,
            name: field.name,
            description,
            type: mapping.type,
            options: mapping.options,
          } as IFieldRo,
        });
        continue;
      }

      if (field.type === 'multipleLookupValues') {
        const linkFieldId = field.options?.recordLinkFieldId ?? '';
        const targetFieldId = field.options?.fieldIdInLinkedTable ?? '';
        const linkField = table.fields.find((candidate) => candidate.id === linkFieldId);
        const foreignTable = tableById.get(linkField?.options?.linkedTableId ?? '');
        const targetField = foreignTable?.fields.find(
          (candidate) => candidate.id === targetFieldId
        );
        const targetIsPlain =
          targetField &&
          !['multipleRecordLinks', 'multipleLookupValues', 'rollup', 'count'].includes(
            targetField.type
          );
        if (
          field.options?.isValid !== false &&
          (plannedLinkIds.has(linkFieldId) || inverseFieldIds.has(linkFieldId)) &&
          foreignTable &&
          targetIsPlain
        ) {
          const teableFieldId = generateFieldId();
          fieldIdMap[field.id] = teableFieldId;
          plan.lookupFields.push({
            airtableFieldId: field.id,
            teableFieldId,
            name: field.name,
            description,
            airtableLinkFieldId: linkFieldId,
            airtableForeignTableId: foreignTable.id,
            airtableTargetFieldId: targetFieldId,
          });
          continue;
        }
        issues.push({
          code: 'fieldDegraded',
          tableName: table.name,
          fieldName: field.name,
          fromType: field.type,
          toType: longTextSnapshotLabel,
        });
        const teableFieldId = generateFieldId();
        fieldIdMap[field.id] = teableFieldId;
        plan.fields.push({
          airtableFieldId: field.id,
          converter: 'snapshotText',
          ro: {
            id: teableFieldId,
            name: field.name,
            description,
            type: FieldType.LongText,
            options: {},
          } as IFieldRo,
        });
        continue;
      }

      if (field.type === 'formula' || field.type === 'rollup') {
        // Recreate as a live computed field when possible: a formula when every
        // function translates, a rollup when its aggregation maps and the base
        // model (from the shared link) supplied its source. Otherwise the
        // computed values are kept as a typed static snapshot so no data is lost.
        const translation =
          field.type === 'formula' && field.options?.formula && field.options?.isValid !== false
            ? translateAirtableFormula(field.options.formula)
            : null;
        const teableFieldId = generateFieldId();
        fieldIdMap[field.id] = teableFieldId;
        if (translation?.ok) {
          plan.formulaFields.push({
            airtableFieldId: field.id,
            teableFieldId,
            name: field.name,
            description,
            expression: translation.expression,
          });
          continue;
        }
        if (field.type === 'rollup') {
          const source = rollupSources?.get(field.id);
          const expression = source ? mapAirtableRollupAggregation(source.aggregation) : null;
          const linkField = table.fields.find(
            (candidate) => candidate.id === source?.relationColumnId
          );
          const foreignTableId = linkField?.options?.linkedTableId ?? '';
          const linkIsImported =
            !!source &&
            (plannedLinkIds.has(source.relationColumnId) ||
              inverseFieldIds.has(source.relationColumnId));
          if (source && expression && linkIsImported && tableById.has(foreignTableId)) {
            plan.rollupFields.push({
              airtableFieldId: field.id,
              teableFieldId,
              name: field.name,
              description,
              expression,
              airtableLinkFieldId: source.relationColumnId,
              airtableForeignTableId: foreignTableId,
              airtableForeignFieldId: source.foreignTableRollupColumnId,
              filter: source.filter,
            });
            continue;
          }
        }
        const mapping = snapshotMappingFromResult(field.options?.result);
        issues.push({
          code: 'fieldDegraded',
          tableName: table.name,
          fieldName: field.name,
          fromType: field.type,
          toType: `${mapping.type} snapshot`,
        });
        plan.fields.push({
          airtableFieldId: field.id,
          converter: mapping.converter,
          ro: {
            id: teableFieldId,
            name: field.name,
            description,
            type: mapping.type,
            options: mapping.options,
          } as IFieldRo,
        });
        continue;
      }

      const mapping = mapField(field, fieldNameById);
      if (mapping.kind === 'skip') {
        issues.push({
          code: 'fieldSkipped',
          tableName: table.name,
          fieldName: field.name,
          fromType: field.type,
          reason: mapping.reason,
        });
        continue;
      }
      if (mapping.degradedTo) {
        issues.push({
          code: 'fieldDegraded',
          tableName: table.name,
          fieldName: field.name,
          fromType: field.type,
          toType: mapping.degradedTo,
        });
      }
      const teableFieldId = generateFieldId();
      fieldIdMap[field.id] = teableFieldId;
      plan.fields.push({
        airtableFieldId: field.id,
        converter: mapping.converter,
        aiPromptParts: mapping.aiPromptParts,
        ro: {
          id: teableFieldId,
          name: field.name,
          description,
          type: mapping.type,
          options: mapping.options,
        } as IFieldRo,
      });
    }

    applyPrimaryField(table, plan, issues, fieldIdMap);
    return plan;
  });

  return { tables: tablePlans, fieldIdMap, issues };
};
/* eslint-enable sonarjs/cognitive-complexity */

/**
 * Ensures the table has a valid primary field as its first phase-1 field.
 * When the Airtable primary field maps to something that cannot be a Teable
 * primary (link, attachment, checkbox…), it is replaced by a text snapshot.
 */
const applyPrimaryField = (
  table: IAirtableTable,
  plan: IAirtableTablePlan,
  issues: IImportAirtableIssue[],
  fieldIdMap: Record<string, string>
) => {
  const primaryIndex = plan.fields.findIndex(
    (field) => field.airtableFieldId === table.primaryFieldId
  );
  const primaryField = primaryIndex >= 0 ? plan.fields[primaryIndex] : undefined;
  const isCompatible = primaryField && !primaryIncompatibleTypes.has(primaryField.ro.type);

  if (primaryField && isCompatible) {
    plan.fields.splice(primaryIndex, 1);
    plan.fields.unshift({
      ...primaryField,
      ro: { ...primaryField.ro, isPrimary: true } as IFieldRo,
    });
    return;
  }

  // The Airtable primary maps to a phase-2 field or an incompatible type:
  // degrade it (or synthesize one) as a text snapshot primary.
  const airtableField = table.fields.find((field) => field.id === table.primaryFieldId);
  const name = airtableField?.name ?? 'Name';
  if (primaryField) {
    plan.fields.splice(primaryIndex, 1);
  }
  plan.linkFields = plan.linkFields.filter(
    (field) => field.airtableFieldId !== table.primaryFieldId
  );
  plan.lookupFields = plan.lookupFields.filter(
    (field) => field.airtableFieldId !== table.primaryFieldId
  );
  plan.countFields = plan.countFields.filter(
    (field) => field.airtableFieldId !== table.primaryFieldId
  );
  const teableFieldId = generateFieldId();
  fieldIdMap[table.primaryFieldId] = teableFieldId;
  issues.push({
    code: 'fieldDegraded',
    tableName: table.name,
    fieldName: name,
    fromType: airtableField?.type ?? 'unknown',
    toType: 'singleLineText snapshot',
  });
  plan.fields.unshift({
    airtableFieldId: table.primaryFieldId,
    converter: 'snapshotText',
    ro: {
      id: teableFieldId,
      name,
      type: FieldType.SingleLineText,
      options: {},
      isPrimary: true,
    } as IFieldRo,
  });
};
