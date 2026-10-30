import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldKeyType,
  FieldType,
  Relationship,
  Role,
  stringifyClipboardText,
  type IBaseRole,
} from '@teable/core';
import {
  BASE_SHARE_ID_HEADER,
  PASTE_URL,
  createBaseShare,
  deleteBaseShare,
  emailBaseInvitation,
  getBaseNodeList,
  updateBaseShare,
  urlBuilder,
  type ITableFullVo,
} from '@teable/openapi';
import type { AxiosInstance } from 'axios';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createSpace,
  createTable,
  getRecords,
  getTable,
  initApp,
  permanentDeleteSpace,
} from './utils/init-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

type TableSnapshot = Array<{ id: string; fields: unknown }>;

describe('Community cross-base paste link auto-create authorization (T8153/Y3568 e2e)', () => {
  let app: INestApplication;
  let spaceId: string;
  let sourceBaseId: string;
  let foreignBaseId: string;
  let sourceTable: ITableFullVo;
  let foreignTargetTable: ITableFullVo;
  let sameBaseTargetTable: ITableFullVo;
  let foreignLinkFieldId: string;
  let sameBaseLinkFieldId: string;
  let foreignLinkColumnIndex: number;
  let sameBaseLinkColumnIndex: number;
  let viewerPasterAxios: AxiosInstance;
  let editorPasterAxios: AxiosInstance;
  let creatorPasterAxios: AxiosInstance;
  let sharePasterAxios: AxiosInstance;
  let editableDirectShareId: string;
  let linkedOnlyShareId: string;
  let previousForceV2All: string | undefined;

  const pasteLinkTitle = (
    client: AxiosInstance,
    title: string,
    columnIndex: number,
    rowIndex: number,
    baseShareId?: string
  ) =>
    client.patch(
      urlBuilder(PASTE_URL, { tableId: sourceTable.id }),
      {
        viewId: sourceTable.defaultViewId,
        content: stringifyClipboardText([[title]]),
        ranges: [
          [columnIndex, rowIndex],
          [columnIndex, rowIndex],
        ],
      },
      baseShareId ? { headers: { [BASE_SHARE_ID_HEADER]: baseShareId } } : undefined
    );

  const tableSnapshot = async (table: ITableFullVo): Promise<TableSnapshot> => {
    const { records } = await getRecords(table.id, {
      viewId: table.defaultViewId,
      fieldKeyType: FieldKeyType.Id,
    });
    return records
      .map((record) => ({ id: record.id, fields: record.fields }))
      .sort((left, right) => left.id.localeCompare(right.id));
  };

  const targetTitles = async (table: ITableFullVo): Promise<string[]> => {
    const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Name });
    return records.map((record) => String(record.fields.Name ?? ''));
  };

  const targetOptionNames = async (): Promise<string[]> => {
    const table = await getTable(foreignBaseId, foreignTargetTable.id, { includeContent: true });
    const primary = table.fields?.find((field) => field.isPrimary);
    const choices = (primary?.options as { choices?: Array<{ name: string }> } | undefined)
      ?.choices;
    return (choices ?? []).map((choice) => choice.name).sort();
  };

  const linkedTitles = (fields: unknown, fieldId: string): string[] => {
    if (!fields || typeof fields !== 'object') return [];
    const value = (fields as Record<string, unknown>)[fieldId];
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (item && typeof item === 'object' && 'title' in item) {
        return String(item.title);
      }
      return '';
    });
  };

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    app = (await initApp()).app;
    spaceId = (await createSpace({ name: `community-cross-base-paste-authz-${Date.now()}` })).id;
    sourceBaseId = (await createBase({ spaceId, name: 'writable source' })).id;
    foreignBaseId = (await createBase({ spaceId, name: 'foreign target' })).id;

    foreignTargetTable = await createTable(foreignBaseId, {
      name: 'foreign target',
      fields: [
        {
          name: 'Name',
          type: FieldType.SingleSelect,
          isPrimary: true,
          options: {
            choices: [{ name: 'Existing foreign title', color: Colors.Blue }],
          },
        },
      ],
      records: [{ fields: { Name: 'Existing foreign title' } }],
    });
    const foreignPrimaryFieldId = foreignTargetTable.fields.find((field) => field.isPrimary)?.id;
    if (!foreignPrimaryFieldId) {
      throw new Error('Missing foreign target primary field');
    }

    sameBaseTargetTable = await createTable(sourceBaseId, {
      name: 'same-base target',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [],
    });
    const sameBasePrimaryFieldId = sameBaseTargetTable.fields.find((field) => field.isPrimary)?.id;
    if (!sameBasePrimaryFieldId) {
      throw new Error('Missing same-base target primary field');
    }

    sourceTable = await createTable(sourceBaseId, {
      name: 'source',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Foreign Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: foreignTargetTable.id,
            lookupFieldId: foreignPrimaryFieldId,
            baseId: foreignBaseId,
            isOneWay: true,
          },
        },
        {
          name: 'Same-base Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: sameBaseTargetTable.id,
            lookupFieldId: sameBasePrimaryFieldId,
            isOneWay: true,
          },
        },
      ],
      records: [
        { fields: { Name: 'Denied host' } },
        { fields: { Name: 'Existing-reference host' } },
        { fields: { Name: 'Foreign-create host' } },
        { fields: { Name: 'Same-base-create host' } },
        { fields: { Name: 'Direct-share-create host' } },
        { fields: { Name: 'Linked-only-create host' } },
      ],
    });

    foreignLinkFieldId =
      sourceTable.fields.find((field) => field.name === 'Foreign Link')?.id ?? '';
    sameBaseLinkFieldId =
      sourceTable.fields.find((field) => field.name === 'Same-base Link')?.id ?? '';
    foreignLinkColumnIndex = sourceTable.fields.findIndex(
      (field) => field.id === foreignLinkFieldId
    );
    sameBaseLinkColumnIndex = sourceTable.fields.findIndex(
      (field) => field.id === sameBaseLinkFieldId
    );
    if (
      !foreignLinkFieldId ||
      !sameBaseLinkFieldId ||
      foreignLinkColumnIndex < 0 ||
      sameBaseLinkColumnIndex < 0
    ) {
      throw new Error('Missing source link field');
    }

    // Neither actor receives a role on the containing space. Their authority is
    // limited to these explicit base invitations.
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const viewerPasterEmail = `community-cross-base-viewer-${suffix}@example.com`;
    const creatorPasterEmail = `community-cross-base-creator-${suffix}@example.com`;
    const editorPasterEmail = `community-cross-base-editor-${suffix}@example.com`;
    viewerPasterAxios = await createNewUserAxios({
      email: viewerPasterEmail,
      password: 'Community-T8153-123',
    });
    creatorPasterAxios = await createNewUserAxios({
      email: creatorPasterEmail,
      password: 'Community-T8153-123',
    });
    editorPasterAxios = await createNewUserAxios({
      email: editorPasterEmail,
      password: 'Community-T8153-123',
    });

    const invite = (baseId: string, email: string, role: IBaseRole) =>
      emailBaseInvitation({
        baseId,
        emailBaseInvitationRo: { emails: [email], role },
      });

    await invite(sourceBaseId, viewerPasterEmail, Role.Creator);
    await invite(foreignBaseId, viewerPasterEmail, Role.Viewer);
    await invite(sourceBaseId, editorPasterEmail, Role.Creator);
    await invite(foreignBaseId, editorPasterEmail, Role.Editor);
    await invite(sourceBaseId, creatorPasterEmail, Role.Creator);
    await invite(foreignBaseId, creatorPasterEmail, Role.Creator);

    // This actor has no collaborator role; the project shares are its only authority.
    sharePasterAxios = await createNewUserAxios({
      email: `community-base-share-paster-${suffix}@example.com`,
      password: 'Community-T8153-123',
    });
    const sourceNode = (await getBaseNodeList(sourceBaseId)).data.find(
      (node) => node.resourceId === sourceTable.id
    );
    if (!sourceNode) throw new Error('Missing source table node');

    editableDirectShareId = (await createBaseShare(sourceBaseId, {})).data.shareId;
    await updateBaseShare(sourceBaseId, editableDirectShareId, { allowEdit: true });
    linkedOnlyShareId = (await createBaseShare(sourceBaseId, { nodeId: sourceNode.id })).data
      .shareId;
    await updateBaseShare(sourceBaseId, linkedOnlyShareId, { allowEdit: true });
  });

  afterAll(async () => {
    if (sourceBaseId && editableDirectShareId) {
      await deleteBaseShare(sourceBaseId, editableDirectShareId).catch(() => undefined);
    }
    if (sourceBaseId && linkedOnlyShareId) {
      await deleteBaseShare(sourceBaseId, linkedOnlyShareId).catch(() => undefined);
    }
    if (spaceId) {
      await permanentDeleteSpace(spaceId).catch(() => undefined);
    }
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app?.close();
  });

  it('denies a missing foreign title for a Viewer and leaves both tables unchanged', async () => {
    const sourceBefore = await tableSnapshot(sourceTable);
    const targetBefore = await tableSnapshot(foreignTargetTable);

    const error = await getError(() =>
      pasteLinkTitle(viewerPasterAxios, 'Denied foreign title', foreignLinkColumnIndex, 0)
    );

    expect.soft(error?.status).toBe(403);
    expect(await tableSnapshot(sourceTable)).toEqual(sourceBefore);
    expect(await tableSnapshot(foreignTargetTable)).toEqual(targetBefore);
  });

  it('allows a target Editor to paste an existing option without changing target schema', async () => {
    const targetBefore = await tableSnapshot(foreignTargetTable);
    const optionsBefore = await targetOptionNames();

    const response = await pasteLinkTitle(
      editorPasterAxios,
      'Existing foreign title',
      foreignLinkColumnIndex,
      1
    );

    expect(response.status).toBe(200);
    expect(await tableSnapshot(foreignTargetTable)).toEqual(targetBefore);
    expect(await targetOptionNames()).toEqual(optionsBefore);
    const sourceAfter = await tableSnapshot(sourceTable);
    expect(
      sourceAfter.flatMap((record) => linkedTitles(record.fields, foreignLinkFieldId))
    ).toContain('Existing foreign title');
  });

  it('denies a target Editor adding a primary option and leaves source, target and schema unchanged', async () => {
    const sourceBefore = await tableSnapshot(sourceTable);
    const targetBefore = await tableSnapshot(foreignTargetTable);
    const optionsBefore = await targetOptionNames();

    const error = await getError(() =>
      pasteLinkTitle(editorPasterAxios, 'Denied editor option', foreignLinkColumnIndex, 0)
    );

    expect.soft(error?.status).toBe(403);
    expect(await tableSnapshot(sourceTable)).toEqual(sourceBefore);
    expect(await tableSnapshot(foreignTargetTable)).toEqual(targetBefore);
    expect(await targetOptionNames()).toEqual(optionsBefore);
  });

  it('allows a foreign Creator to auto-create exactly one target record', async () => {
    const targetBefore = await tableSnapshot(foreignTargetTable);
    const optionsBefore = await targetOptionNames();

    const response = await pasteLinkTitle(
      creatorPasterAxios,
      'Allowed foreign title',
      foreignLinkColumnIndex,
      2
    );

    expect(response.status).toBe(200);
    const targetAfter = await tableSnapshot(foreignTargetTable);
    expect(targetAfter).toHaveLength(targetBefore.length + 1);
    expect(
      (await targetTitles(foreignTargetTable)).filter((title) => title === 'Allowed foreign title')
    ).toHaveLength(1);
    expect(await targetOptionNames()).toEqual([...optionsBefore, 'Allowed foreign title'].sort());
    const sourceAfter = await tableSnapshot(sourceTable);
    expect(
      sourceAfter.flatMap((record) => linkedTitles(record.fields, foreignLinkFieldId))
    ).toContain('Allowed foreign title');
  });

  it('allows the source Creator to auto-create through a same-base Link', async () => {
    const targetBefore = await tableSnapshot(sameBaseTargetTable);
    const foreignBefore = await tableSnapshot(foreignTargetTable);

    const response = await pasteLinkTitle(
      viewerPasterAxios,
      'Allowed same-base title',
      sameBaseLinkColumnIndex,
      3
    );

    expect(response.status).toBe(200);
    const targetAfter = await tableSnapshot(sameBaseTargetTable);
    expect(targetAfter).toHaveLength(targetBefore.length + 1);
    expect(
      (await targetTitles(sameBaseTargetTable)).filter(
        (title) => title === 'Allowed same-base title'
      )
    ).toHaveLength(1);
    expect(await tableSnapshot(foreignTargetTable)).toEqual(foreignBefore);
    const sourceAfter = await tableSnapshot(sourceTable);
    expect(
      sourceAfter.flatMap((record) => linkedTitles(record.fields, sameBaseLinkFieldId))
    ).toContain('Allowed same-base title');
  });

  it('allows an editable project share to auto-create in a directly shared target', async () => {
    const targetBefore = await tableSnapshot(sameBaseTargetTable);

    const response = await pasteLinkTitle(
      sharePasterAxios,
      'Allowed direct-share title',
      sameBaseLinkColumnIndex,
      4,
      editableDirectShareId
    );

    expect(response.status).toBe(200);
    expect(await tableSnapshot(sameBaseTargetTable)).toHaveLength(targetBefore.length + 1);
    expect(
      (await targetTitles(sameBaseTargetTable)).filter(
        (title) => title === 'Allowed direct-share title'
      )
    ).toHaveLength(1);
    const sourceAfter = await tableSnapshot(sourceTable);
    expect(
      sourceAfter.flatMap((record) => linkedTitles(record.fields, sameBaseLinkFieldId))
    ).toContain('Allowed direct-share title');
  });

  it('denies project-share auto-create when the target is reachable only through a link', async () => {
    const sourceBefore = await tableSnapshot(sourceTable);
    const targetBefore = await tableSnapshot(sameBaseTargetTable);

    const error = await getError(() =>
      pasteLinkTitle(
        sharePasterAxios,
        'Denied linked-only title',
        sameBaseLinkColumnIndex,
        5,
        linkedOnlyShareId
      )
    );

    expect.soft(error?.status).toBe(403);
    expect(await tableSnapshot(sourceTable)).toEqual(sourceBefore);
    expect(await tableSnapshot(sameBaseTargetTable)).toEqual(targetBefore);
  });
});
