import { z } from 'zod';
import { IdPrefix } from '../../utils';
import type { FieldCore } from '../field/field';

export enum FieldKeyType {
  Id = 'id',
  Name = 'name',
  DbFieldName = 'dbFieldName',
}

export enum CellFormat {
  Json = 'json',
  Text = 'text',
}
/** Trusted business initiator of a record mutation; never a client-supplied identity. */
export const recordActorTypeSchema = z.enum(['user', 'appUser', 'automation', 'system']).meta({
  description: 'The trusted initiator kind recorded for a row actor column.',
});

export type RecordActorType = z.infer<typeof recordActorTypeSchema>;

export class RecordCore {
  constructor(protected fieldMap: { [fieldId: string]: FieldCore }) {}

  name?: string;

  commentCount!: number;

  createdTime!: Date;

  id!: string;

  isDeleted = false;

  fields!: Record<string, unknown>;

  permissions?: Record<'read' | 'update', Record<string, boolean>>;

  /**
   * Trusted business initiator of the row. Independent of `createdBy`, which keeps its
   * platform user / executor meaning. `null` means unknown or actor storage disabled for the
   * table, never a guessed user.
   */
  createdByActorType!: RecordActorType | null;

  createdByActorId!: string | null;

  lastModifiedByActorType!: RecordActorType | null;

  lastModifiedByActorId!: string | null;

  undeletable?: boolean;

  getCellValue(fieldId: string): unknown {
    return this.fields[fieldId];
  }

  getCellValueAsString(fieldId: string) {
    return this.fieldMap[fieldId].cellValue2String(this.fields[fieldId]);
  }
}

export const recordSchema = z.object({
  id: z.string().startsWith(IdPrefix.Record).meta({
    description: 'The record id.',
  }),
  name: z.string().optional().meta({ description: 'primary field value' }),
  fields: z.record(z.string(), z.unknown()).meta({
    description: 'Objects with a fields key mapping fieldId or field name to value for that field.',
  }),
  autoNumber: z.number().optional().meta({
    description: 'Auto number, a unique identifier for each record',
  }),
  createdTime: z.string().optional().meta({
    description: 'Created time, date ISO string (new Date().toISOString).',
  }),
  lastModifiedTime: z.string().optional().meta({
    description: 'Last modified time, date ISO string (new Date().toISOString).',
  }),
  createdBy: z.string().optional().meta({
    description: 'Created by, user name',
  }),
  lastModifiedBy: z.string().optional().meta({
    description: 'Last modified by, user name',
  }),
  createdByActorType: recordActorTypeSchema.nullable().optional().meta({
    description:
      'Trusted initiator type of the row creator. Absent or null means unknown or actor attribution disabled for the table; it never replaces createdBy.',
  }),
  createdByActorId: z.string().nullable().optional().meta({
    description:
      'Stable principal id of the row creator (user id, app user principal id, automation stable id or system service id).',
  }),
  lastModifiedByActorType: recordActorTypeSchema.nullable().optional().meta({
    description:
      'Trusted initiator type of the last actual field mutation. Absent or null means unknown or actor attribution disabled for the table; it never replaces lastModifiedBy.',
  }),
  lastModifiedByActorId: z.string().nullable().optional().meta({
    description:
      'Stable principal id of the last actual field mutation (user id, app user principal id, automation stable id or system service id).',
  }),
  permissions: z.record(z.string(), z.record(z.string(), z.boolean())).optional().meta({
    description: 'Permissions for the record',
  }),
  undeletable: z.boolean().optional().meta({
    description: 'Whether the record is undeletable',
  }),
});

export type IRecord = z.infer<typeof recordSchema>;
