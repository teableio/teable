import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import { executeRedo, executeUndo } from '../../shared/undoRedoE2eTestKit';
import {
  asMatrixCreateFieldInput,
  createFieldUndoRedoMatrixEnv,
  fieldMatrixCases,
  type FieldUndoRedoMatrixEnv,
} from '../shared/fieldUndoRedoMatrixTestKit';

describe('undo-redo/updateField field matrix (e2e)', () => {
  let ctx: SharedTestContext;
  let env: FieldUndoRedoMatrixEnv;
  let sequence = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    env = await createFieldUndoRedoMatrixEnv(ctx, 'Undo Matrix Update Field');
  });

  test.each(fieldMatrixCases)('update %s undo/redo', async (fieldCase) => {
    sequence += 1;
    const field = await fieldCase.buildField(env, sequence);
    const fieldId = field.id as string;
    const originalName = field.name as string;
    const updatedName = `${originalName} Renamed`;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: env.hostTableId,
      field: asMatrixCreateFieldInput(field),
    });
    await ctx.updateField({
      tableId: env.hostTableId,
      fieldId,
      field: {
        name: updatedName,
        description: 'undo-redo matrix updated',
      },
    });

    let hostTable = await env.getHostTable();
    expect(hostTable.fields.find((item) => item.id === fieldId)?.name).toBe(updatedName);

    await executeUndo(ctx, env.hostTableId);
    hostTable = await env.getHostTable();
    expect(hostTable.fields.find((item) => item.id === fieldId)?.name).toBe(originalName);

    await executeRedo(ctx, env.hostTableId);
    hostTable = await env.getHostTable();
    expect(hostTable.fields.find((item) => item.id === fieldId)?.name).toBe(updatedName);
  });
});
