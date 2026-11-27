import { BaseNodeResourceType } from '@teable/openapi';
import { afterEach, describe, expect, it } from 'vitest';
import type { TreeItemData } from '../../../base/base-node/hooks';
import { clearPublishDraft, patchPublishDraft, readPublishDraft } from './publish-draft';
import { getUnpublishedAppNodes } from './UnpublishedAppsDialog';

describe('publish draft', () => {
  afterEach(() => window.localStorage.clear());

  it('keeps each field as it is typed, per project, until cleared', () => {
    patchPublishDraft('bse1', { title: 'CRM' });
    patchPublishDraft('bse1', { description: 'Track deals' });
    patchPublishDraft('bse2', { title: 'Other' });

    expect(readPublishDraft('bse1')).toEqual({ title: 'CRM', description: 'Track deals' });
    expect(readPublishDraft('bse2')).toEqual({ title: 'Other' });

    clearPublishDraft('bse1');
    expect(readPublishDraft('bse1')).toEqual({});
  });

  it('reads nothing from a broken entry', () => {
    window.localStorage.setItem('teable:publish-draft:bse1', '{not json');
    expect(readPublishDraft('bse1')).toEqual({});
  });
});

describe('getUnpublishedAppNodes', () => {
  const app = (publishedVersion?: number, publicUrl?: string) =>
    ({
      id: 'bno1',
      resourceId: 'app1',
      resourceType: BaseNodeResourceType.App,
      resourceMeta: { name: 'Quote', publishedVersion, publicUrl },
    }) as unknown as TreeItemData;

  it('counts an app published at version 0 as published', () => {
    expect(getUnpublishedAppNodes(['bno1'], { bno1: app(0, 'https://a.example') })).toEqual([]);
  });

  it('lists an app with no published version or no public URL', () => {
    expect(
      getUnpublishedAppNodes(['bno1'], { bno1: app(undefined, 'https://a.example') })
    ).toHaveLength(1);
    expect(getUnpublishedAppNodes(['bno1'], { bno1: app(2) })).toHaveLength(1);
  });
});
