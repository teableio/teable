import { describe, expect, it } from 'vitest';

import { buildLinkRecordQueryBase } from './LinkRecordQuery';

describe('buildLinkRecordQueryBase', () => {
  it('keeps link editor modules importable', async () => {
    await expect(import('./Editor')).resolves.toHaveProperty('LinkEditor');
    await expect(import('./EditorMain')).resolves.toHaveProperty('LinkEditorMain');
  }, 20000);

  it('forwards link hidden-field and filter-view config to record queries', () => {
    expect(
      buildLinkRecordQueryBase({
        filterByViewId: 'viwConfigured',
        visibleFieldIds: ['fldPrimary', 'fldDescription'],
      })
    ).toEqual({
      viewId: 'viwConfigured',
      projection: ['fldPrimary', 'fldDescription'],
    });
  });

  it('omits projection when no hidden-field config exists', () => {
    expect(
      buildLinkRecordQueryBase({
        filterByViewId: null,
        visibleFieldIds: null,
      })
    ).toEqual({});
  });
});
