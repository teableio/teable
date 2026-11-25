import { z } from 'zod';

export const recordInitiatorKinds = ['user', 'appUser', 'automation', 'system'] as const;
export const recordInitiatorKindSchema = z.enum(recordInitiatorKinds);
export const recordInitiatorSchema = z.object({
  type: recordInitiatorKindSchema,
  id: z.string().min(1),
});

/** Attribution supplied by a trusted host after authentication; never a record input. */
export type RecordInitiator = Readonly<z.infer<typeof recordInitiatorSchema>>;

export const isRecordInitiatorKind = (value: unknown): value is RecordInitiator['type'] =>
  typeof value === 'string' && (recordInitiatorKinds as readonly string[]).includes(value);
