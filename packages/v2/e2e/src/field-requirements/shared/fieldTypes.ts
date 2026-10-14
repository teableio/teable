/**
 * The 22 v2 field types, as one table.
 *
 * §2 of the requirement document is a capability matrix keyed by field type.
 * Every requirement-driven matrix in this directory reads its rows from here so
 * the enum can only be wrong in one place, and so adding a field type to
 * `FieldType.fieldTypeValues` fails the `covers every registered field type`
 * case below instead of silently dropping out of the coverage.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { fieldTypeValues } from '@teable/v2-core';

export type FieldTypeName = (typeof fieldTypeValues)[number];

export type FieldTypeSpec = {
  /** §2 requirement id for this field type. */
  readonly requirement: string;
  readonly type: FieldTypeName;
  /** §2 column "默认值或自动值": can a user configure a real default? */
  readonly defaultKind: 'user' | 'automatic' | 'none';
  /**
   * §2 column "计算关注点" value shape, which is what drives the §7 statistic
   * set and the §6 rollup function set.
   */
  readonly valueKind: 'string' | 'number' | 'dateTime' | 'boolean' | 'none';
  /** Whether the type can produce an array of values. */
  readonly multiValueCapable: boolean;
  /** Whether the type is derived rather than stored (F12–F14, F21, F22). */
  readonly derived: boolean;
};

/**
 * §2 全字段能力矩阵, one row per field type, in document order.
 *
 * `defaultKind`: `user` = a configurable default exists, `automatic` = the
 * system supplies the value, `none` = no value at all.
 */
export const FIELD_TYPE_SPECS: ReadonlyArray<FieldTypeSpec> = [
  {
    requirement: 'F01',
    type: 'singleLineText',
    defaultKind: 'user',
    valueKind: 'string',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F02',
    type: 'longText',
    defaultKind: 'user',
    valueKind: 'string',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F03',
    type: 'number',
    defaultKind: 'user',
    valueKind: 'number',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F04',
    type: 'date',
    defaultKind: 'user',
    valueKind: 'dateTime',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F05',
    type: 'singleSelect',
    defaultKind: 'user',
    valueKind: 'string',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F06',
    type: 'multipleSelect',
    defaultKind: 'user',
    valueKind: 'string',
    multiValueCapable: true,
    derived: false,
  },
  {
    requirement: 'F07',
    type: 'checkbox',
    defaultKind: 'user',
    valueKind: 'boolean',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F08',
    type: 'rating',
    defaultKind: 'none',
    valueKind: 'number',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F09',
    type: 'user',
    defaultKind: 'user',
    valueKind: 'string',
    multiValueCapable: true,
    derived: false,
  },
  {
    requirement: 'F10',
    type: 'attachment',
    defaultKind: 'none',
    valueKind: 'string',
    multiValueCapable: true,
    derived: false,
  },
  {
    requirement: 'F11',
    type: 'link',
    defaultKind: 'none',
    valueKind: 'string',
    multiValueCapable: true,
    derived: false,
  },
  {
    requirement: 'F12',
    type: 'formula',
    defaultKind: 'none',
    valueKind: 'number',
    multiValueCapable: false,
    derived: true,
  },
  {
    requirement: 'F13',
    type: 'rollup',
    defaultKind: 'none',
    valueKind: 'number',
    multiValueCapable: false,
    derived: true,
  },
  {
    requirement: 'F14',
    type: 'conditionalRollup',
    defaultKind: 'none',
    valueKind: 'number',
    multiValueCapable: false,
    derived: true,
  },
  {
    requirement: 'F15',
    type: 'createdTime',
    defaultKind: 'automatic',
    valueKind: 'dateTime',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F16',
    type: 'lastModifiedTime',
    defaultKind: 'automatic',
    valueKind: 'dateTime',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F17',
    type: 'createdBy',
    defaultKind: 'automatic',
    valueKind: 'string',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F18',
    type: 'lastModifiedBy',
    defaultKind: 'automatic',
    valueKind: 'string',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F19',
    type: 'autoNumber',
    defaultKind: 'automatic',
    valueKind: 'number',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F20',
    type: 'button',
    defaultKind: 'none',
    valueKind: 'none',
    multiValueCapable: false,
    derived: false,
  },
  {
    requirement: 'F21',
    type: 'lookup',
    defaultKind: 'none',
    valueKind: 'string',
    multiValueCapable: false,
    derived: true,
  },
  {
    requirement: 'F22',
    type: 'conditionalLookup',
    defaultKind: 'none',
    valueKind: 'string',
    multiValueCapable: false,
    derived: true,
  },
];

export const fieldTypeSpec = (type: FieldTypeName): FieldTypeSpec => {
  const spec = FIELD_TYPE_SPECS.find((candidate) => candidate.type === type);
  if (!spec) throw new Error(`No §2 row registered for field type "${type}"`);
  return spec;
};

/** §2 rows that accept a user-configured default value (D01/D16). */
export const USER_DEFAULTABLE_TYPES: ReadonlyArray<FieldTypeName> = FIELD_TYPE_SPECS.filter(
  (spec) => spec.defaultKind === 'user'
).map((spec) => spec.type);

/** §2 rows the system fills in, which must not accept a user default (D16). */
export const AUTOMATIC_TYPES: ReadonlyArray<FieldTypeName> = FIELD_TYPE_SPECS.filter(
  (spec) => spec.defaultKind === 'automatic'
).map((spec) => spec.type);

/** §2 rows with no cell value or no writable value at all (D16). */
export const NO_DEFAULT_TYPES: ReadonlyArray<FieldTypeName> = FIELD_TYPE_SPECS.filter(
  (spec) => spec.defaultKind === 'none'
).map((spec) => spec.type);

/** Every type the field factory accepts. */
export const REGISTERED_FIELD_TYPES: ReadonlyArray<FieldTypeName> = [...fieldTypeValues];
