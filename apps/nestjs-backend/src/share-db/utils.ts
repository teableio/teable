import { ActionPrefix, IdPrefix } from '@teable/core';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';

export const getPrefixAction = (docType: IdPrefix) => {
  switch (docType) {
    case IdPrefix.View:
      return ActionPrefix.View;
    case IdPrefix.Table:
      return ActionPrefix.Table;
    case IdPrefix.Record:
      return ActionPrefix.Record;
    case IdPrefix.Field:
      return ActionPrefix.Field;
    default:
      return null;
  }
};

export const getAction = (op: CreateOp | DeleteOp | EditOp) => {
  if (op.create) {
    return 'create';
  }
  if (op.del) {
    return 'delete';
  }
  if (op.op) {
    return 'update';
  }
  return null;
};

export const getAxiosBaseUrl = () => `http://localhost:${process.env.PORT}/api`;

// A json0 component carries exactly one instruction; `{ p: [...] }` alone is
// not applicable. `oi`/`od` count when present even as null: an explicit null
// is how an emptied value travels.
const json0InstructionKeys = ['oi', 'od', 'li', 'ld', 'lm', 'na', 't', 'si', 'sd'];

const hasJson0Instruction = (component: unknown): boolean =>
  component !== null &&
  typeof component === 'object' &&
  json0InstructionKeys.some((key) => Reflect.get(component, key) !== undefined);

/**
 * Live ops are deltas published verbatim to every subscriber, so a component
 * without an instruction must never go out: JSON keeps it as `{ p: [...] }`,
 * and every client applying it aborts with ot-json0's
 * "invalid / missing instruction in op" and hard-rolls its document back. Such
 * a component changes nothing, so it is dropped; an op left without any
 * component is not worth publishing at all. Ops that carry no component list
 * (create/delete) pass through untouched.
 */
export const stripInstructionlessComponents = <T extends CreateOp | DeleteOp | EditOp>(
  op: T
): T | undefined => {
  if (!Array.isArray(op.op) || op.op.length === 0) {
    return op;
  }
  const components = op.op.filter(hasJson0Instruction);
  if (components.length === 0) {
    return undefined;
  }
  if (components.length === op.op.length) {
    return op;
  }
  return { ...op, op: components };
};
