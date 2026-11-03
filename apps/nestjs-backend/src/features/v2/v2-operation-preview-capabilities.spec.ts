import type { PreviewCapability } from '@teable/v2-command-explain';
import { describe, expect, it } from 'vitest';
import { withNestOperationPreviewRoutes } from './v2-operation-preview-capabilities';

const capability = (operation: PreviewCapability['operation']): PreviewCapability => ({
  operation,
  canonicalWriteRoute: 'core-only',
  supportLevel: 'partial',
  requiredPermissionScope: 'test',
  detailLevels: ['summary'],
  limitations: [],
});

describe('withNestOperationPreviewRoutes', () => {
  it('advertises the write routes actually mounted by the Nest host', () => {
    const routes = Object.fromEntries(
      withNestOperationPreviewRoutes([
        capability('field.delete'),
        capability('field.convert'),
        capability('table.delete'),
        capability('records.paste'),
        capability('base.duplicate'),
      ]).map(({ operation, canonicalWriteRoute }) => [operation, canonicalWriteRoute])
    );

    expect(routes).toEqual({
      'field.delete': 'DELETE /table/{tableId}/field/{fieldId}',
      'field.convert': 'PUT /table/{tableId}/field/{fieldId}/convert',
      'table.delete': 'DELETE /base/{baseId}/table/{tableId}',
      'records.paste': 'PATCH /table/{tableId}/selection/paste',
      'base.duplicate': 'POST /base/duplicate',
    });
  });

  it('preserves routes already mounted by the generic v2 controller', () => {
    expect(withNestOperationPreviewRoutes([capability('records.bulkDelete')])[0])
      .toMatchObject({ canonicalWriteRoute: 'core-only' });
  });
});
