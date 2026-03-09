import { DuplicateFieldCommand, type DuplicateFieldResult } from '@teable/v2-core';
import { beforeAll, describe, expect, test } from 'vitest';

import { getSharedTestContext, type SharedTestContext } from '../../../shared/globalTestContext';
import {
  buildUndoRedoContext,
  E2E_UNDO_WINDOW_ID,
  executeRedo,
  executeUndo,
  getCommandBus,
} from '../../shared/undoRedoE2eTestKit';
import {
  assertFieldMatrixCasePersisted,
  asMatrixCreateFieldInput,
  createFieldUndoRedoMatrixEnv,
  fieldMatrixCases,
  type FieldUndoRedoMatrixEnv,
} from '../shared/fieldUndoRedoMatrixTestKit';

describe('undo-redo/duplicateField field matrix (e2e)', () => {
  let ctx: SharedTestContext;
  let env: FieldUndoRedoMatrixEnv;
  let sequence = 0;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
    env = await createFieldUndoRedoMatrixEnv(ctx, 'Undo Matrix Duplicate Field');
  });

  test.each(fieldMatrixCases)('duplicate %s undo/redo', async (fieldCase) => {
    sequence += 1;
    const field = await fieldCase.buildField(env, sequence);
    const fieldId = field.id as string;

    await ctx.createField({
      baseId: ctx.baseId,
      tableId: env.hostTableId,
      field: asMatrixCreateFieldInput(field),
    });

    const duplicateResult = (
      await getCommandBus(ctx).execute<DuplicateFieldCommand, DuplicateFieldResult>(
        buildUndoRedoContext(E2E_UNDO_WINDOW_ID),
        DuplicateFieldCommand.create({
          baseId: ctx.baseId,
          tableId: env.hostTableId,
          fieldId,
          includeRecordValues: false,
          newFieldName: `${field.name} Copy`,
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();

    const duplicatedFieldId = duplicateResult.newField.id().toString();
    await assertFieldMatrixCasePersisted(
      fieldCase,
      (await env.getHostTable()).fields.find((item) => item.id === duplicatedFieldId),
      {
        ...field,
        id: duplicatedFieldId,
        name: `${field.name} Copy`,
      }
    );

    await executeUndo(ctx, env.hostTableId);
    expect(
      (await env.getHostTable()).fields.find((item) => item.id === duplicatedFieldId)
    ).toBeUndefined();

    await executeRedo(ctx, env.hostTableId);
    await assertFieldMatrixCasePersisted(
      fieldCase,
      (await env.getHostTable()).fields.find((item) => item.id === duplicatedFieldId),
      {
        ...field,
        id: duplicatedFieldId,
        name: `${field.name} Copy`,
      }
    );
  });
});
