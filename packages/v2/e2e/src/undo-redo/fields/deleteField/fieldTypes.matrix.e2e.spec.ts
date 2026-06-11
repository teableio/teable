import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { executeRedo, executeUndo } from '../../shared/undoRedoE2eTestKit';
import {
  assertFieldMatrixCasePersisted,
  asMatrixCreateFieldInput,
  createFieldUndoRedoMatrixEnv,
  fieldMatrixCases,
  type FieldUndoRedoMatrixEnv,
} from '../shared/fieldUndoRedoMatrixTestKit';

describe('undo-redo/deleteField field matrix (e2e)', () => {
  let ctx: SharedTestContext;
  let env: FieldUndoRedoMatrixEnv;
  let sequence = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    env = await createFieldUndoRedoMatrixEnv(ctx, 'Undo Matrix Delete Field');
  });

  test.each(fieldMatrixCases)('delete %s undo/redo', async (fieldCase) => {
    sequence += 1;
    const field = await fieldCase.buildField(env, sequence);
    const fieldId = field.id as string;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: env.hostTableId,
      field: asMatrixCreateFieldInput(field),
    });
    await ctx.deleteField({ tableId: env.hostTableId, fieldId });
    expect((await env.getHostTable()).fields.find((item) => item.id === fieldId)).toBeUndefined();

    await executeUndo(ctx, env.hostTableId);
    await assertFieldMatrixCasePersisted(
      fieldCase,
      (await env.getHostTable()).fields.find((item) => item.id === fieldId),
      field
    );

    await executeRedo(ctx, env.hostTableId);
    expect((await env.getHostTable()).fields.find((item) => item.id === fieldId)).toBeUndefined();
  });
});
