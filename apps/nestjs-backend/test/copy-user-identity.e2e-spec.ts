import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Role, is } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  COPY_BY_ID_URL,
  COPY_URL,
  GET_RECORDS_URL,
  PASTE_BY_ID_URL,
  PrincipalType,
  SHARE_VIEW_COPY,
  SHARE_VIEW_RECORDS,
  USER_ME,
  X_CANARY_HEADER,
  axios,
  emailSpaceInvitation,
  enableShareView,
  getSpaceCollaboratorList,
  updateViewColumnMeta,
  updateViewShareMeta,
  updateViewFilter,
  urlBuilder,
  type ICopyVo,
  type IPasteByIdVo,
  type IRecordsVo,
  type ITableFullVo,
  type IUserMeVo,
} from '@teable/openapi';
import { GetViewSelectionCopyHandler } from '@teable/v2-core';
import type { AxiosInstance } from 'axios';
import { Window } from '../../nextjs-app/node_modules/happy-dom';
import {
  extractHtmlHeader,
  extractTableContent,
  serializerCellValueHtml,
} from '../../nextjs-app/src/features/app/utils/clipboard';
import { RecordService } from '../src/features/record/record.service';
import { createAnonymousUserAxios } from './utils/axios-instance/anonymous-user';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import { getError } from './utils/get-error';
import {
  createBase,
  createSpace,
  createTable,
  initApp,
  permanentDeleteSpace,
  updateRecord,
} from './utils/init-app';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

type UserIdentity = { id: string; title: string; email?: string };
type RichCopyVo = ICopyVo & { rawContent?: unknown[][] };

const userIdentityFromAuthorizedCell = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(userIdentityFromAuthorizedCell);
  }
  if (value == null || typeof value !== 'object') {
    return value;
  }
  const user = value as Partial<UserIdentity>;
  if (typeof user.id !== 'string' || typeof user.title !== 'string') {
    return value;
  }
  return {
    id: user.id,
    title: user.title,
    ...(typeof user.email === 'string' ? { email: user.email } : {}),
  };
};

const quoteIdentifier = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
const roundTripProductionClipboardHtml = (copy: RichCopyVo) => {
  if (!copy.rawContent) {
    throw new Error('Rich copy response must include rawContent');
  }
  const window = new Window();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousDomParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: window.document },
    DOMParser: { configurable: true, value: window.DOMParser },
  });

  try {
    const html = serializerCellValueHtml(copy.rawContent, copy.header, copy.content);
    const header = extractHtmlHeader(html);
    expect(header.error).toBeUndefined();
    const content = extractTableContent(html);
    expect(content).toEqual(copy.rawContent);
    expect(header.result).toEqual(copy.header);
    if (!content || !header.result) {
      throw new Error('Production clipboard HTML must contain Teable content and headers');
    }
    return { content, header: header.result };
  } finally {
    window.close();
    if (previousDocument) {
      Object.defineProperty(globalThis, 'document', previousDocument);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
    if (previousDomParser) {
      Object.defineProperty(globalThis, 'DOMParser', previousDomParser);
    } else {
      Reflect.deleteProperty(globalThis, 'DOMParser');
    }
  }
};

describe('Copy user identity over real HTTP (e2e)', () => {
  let app: INestApplication;
  let appUrl: string;
  let prisma: PrismaService;
  let anonymous: AxiosInstance;
  let sourceSpaceId: string;
  let targetSpaceId: string;
  let sourceBaseId: string;
  let targetBaseId: string;
  let sourceMember: IUserMeVo;
  let previousForceV2All: string | undefined;

  const owner: UserIdentity = {
    id: globalThis.testConfig.userId,
    title: globalThis.testConfig.userName,
    email: globalThis.testConfig.email,
  };

  const getAuthorizedRecords = async (
    client: AxiosInstance,
    table: ITableFullVo,
    projection?: string[]
  ) =>
    client.get<IRecordsVo>(urlBuilder(GET_RECORDS_URL, { tableId: table.id }), {
      params: {
        viewId: table.defaultViewId,
        fieldKeyType: FieldKeyType.Id,
        projection,
      },
    });

  const copyRange = async (
    client: AxiosInstance,
    table: ITableFullVo,
    projection: string[],
    ranges: Array<[number, number]>
  ) =>
    client.get<RichCopyVo>(urlBuilder(COPY_URL, { tableId: table.id }), {
      params: {
        viewId: table.defaultViewId,
        projection,
        ranges: JSON.stringify(ranges),
      },
    });

  const copyById = async (
    client: AxiosInstance,
    table: ITableFullVo,
    recordIds: string[],
    fieldIds: string[]
  ) =>
    client.post<RichCopyVo>(urlBuilder(COPY_BY_ID_URL, { tableId: table.id }), {
      viewId: table.defaultViewId,
      selection: { recordIds, fieldIds },
    });

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';

    const appContext = await initApp();
    app = appContext.app;
    appUrl = appContext.appUrl;
    prisma = app.get(PrismaService);
    anonymous = createAnonymousUserAxios(appUrl);

    sourceSpaceId = (await createSpace({ name: `copy-identity-source-${Date.now()}` })).id;
    targetSpaceId = (await createSpace({ name: `copy-identity-target-${Date.now()}` })).id;
    sourceBaseId = (await createBase({ spaceId: sourceSpaceId, name: 'copy identity source' })).id;
    targetBaseId = (await createBase({ spaceId: targetSpaceId, name: 'copy identity target' })).id;

    const sourceMemberEmail = `copy-source-member-${Date.now()}@example.com`;
    const sourceMemberClient = await createNewUserAxios({
      email: sourceMemberEmail,
      password: '12345678',
    });
    sourceMember = (await sourceMemberClient.get<IUserMeVo>(USER_ME)).data;
    await emailSpaceInvitation({
      spaceId: sourceSpaceId,
      emailSpaceInvitationRo: { emails: [sourceMemberEmail], role: Role.Editor },
    });

    const targetMembership = await getSpaceCollaboratorList(targetSpaceId, {
      type: PrincipalType.User,
      principalId: sourceMember.id,
    });
    expect(targetMembership.data.collaborators).toEqual([]);
  });

  afterAll(async () => {
    if (sourceSpaceId) {
      await permanentDeleteSpace(sourceSpaceId).catch(() => undefined);
    }
    if (targetSpaceId) {
      await permanentDeleteSpace(targetSpaceId).catch(() => undefined);
    }
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    await app?.close();
  });

  it('returns canonical single and multiple users from range and by-id copy, then pastes them across spaces', async () => {
    const sourceIdentity: UserIdentity = {
      id: sourceMember.id,
      title: sourceMember.name,
      email: sourceMember.email,
    };
    const sourceTable = await createTable(sourceBaseId, {
      name: 'copy identity source records',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Owner', type: FieldType.User },
        {
          name: 'Members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      records: [
        {
          fields: {
            Title: 'first',
            Owner: sourceIdentity,
            Members: [sourceIdentity, owner],
          },
        },
        {
          fields: {
            Title: 'second',
            Owner: owner,
            Members: [sourceIdentity],
          },
        },
      ],
    });
    const targetTable = await createTable(targetBaseId, {
      name: 'copy identity target records',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Owner', type: FieldType.User },
        {
          name: 'Members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      records: [{ fields: { Title: 'target first' } }, { fields: { Title: 'target second' } }],
    });

    const sourceOwnerField = sourceTable.fields.find((field) => field.name === 'Owner')!;
    const sourceMembersField = sourceTable.fields.find((field) => field.name === 'Members')!;
    const targetOwnerField = targetTable.fields.find((field) => field.name === 'Owner')!;
    const targetMembersField = targetTable.fields.find((field) => field.name === 'Members')!;
    const sourceFieldIds = [sourceOwnerField.id, sourceMembersField.id];
    const sourceRecordsResponse = await getAuthorizedRecords(axios, sourceTable, sourceFieldIds);
    const sourceRecords = sourceRecordsResponse.data.records;
    const expectedRaw = sourceRecords.map((record) =>
      sourceFieldIds.map((fieldId) => userIdentityFromAuthorizedCell(record.fields[fieldId]))
    );

    expect(expectedRaw).toEqual([
      [sourceIdentity, [sourceIdentity, owner]],
      [owner, [sourceIdentity]],
    ]);

    const rangeCopy = await copyRange(axios, sourceTable, sourceFieldIds, [
      [0, 0],
      [1, 1],
    ]);
    expect(rangeCopy.status).toBe(200);
    expect(rangeCopy.data.header.map((field) => field.id)).toEqual(sourceFieldIds);
    expect(rangeCopy.data.content).toBe(
      `${sourceIdentity.title}\t${sourceIdentity.title}, ${owner.title}\n${owner.title}\t${sourceIdentity.title}`
    );
    expect(rangeCopy.data.rawContent).toEqual(expectedRaw);

    const idCopy = await copyById(
      axios,
      sourceTable,
      sourceRecords.map((record) => record.id),
      sourceFieldIds
    );
    expect(idCopy.status).toBe(201);
    expect(idCopy.data.header.map((field) => field.id)).toEqual(sourceFieldIds);
    expect(idCopy.data.content).toBe(rangeCopy.data.content);
    expect(idCopy.data.rawContent).toEqual(expectedRaw);

    const clipboard = roundTripProductionClipboardHtml(idCopy.data);
    const targetRecordIds = targetTable.records.map((record) => record.id);
    const targetFieldIds = [targetOwnerField.id, targetMembersField.id];
    const paste = await axios.patch<IPasteByIdVo>(
      urlBuilder(PASTE_BY_ID_URL, { tableId: targetTable.id }),
      {
        viewId: targetTable.defaultViewId,
        selection: { recordIds: targetRecordIds, fieldIds: targetFieldIds },
        content: clipboard.content,
        header: clipboard.header,
      }
    );
    expect(paste.status).toBe(200);
    expect(paste.data.selection).toEqual({
      recordIds: targetRecordIds,
      fieldIds: targetFieldIds,
    });
    expect(paste.data.pastedRecordIds).toEqual(targetRecordIds);
    expect(paste.data.pastedFieldIds).toEqual(targetFieldIds);

    const targetRecordsResponse = await getAuthorizedRecords(axios, targetTable, [
      targetOwnerField.id,
      targetMembersField.id,
    ]);
    expect(
      targetRecordsResponse.data.records.map((record) => [
        userIdentityFromAuthorizedCell(record.fields[targetOwnerField.id]),
        userIdentityFromAuthorizedCell(record.fields[targetMembersField.id]),
      ])
    ).toEqual(expectedRaw);
  });

  it('does not disclose email and rejects an unknown stored user on cross-space paste', async () => {
    const table = await createTable(sourceBaseId, {
      name: 'copy identity no directory enrichment',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Stored user', type: FieldType.User },
      ],
      records: [{ fields: { Title: 'stored only' } }, { fields: { Title: 'empty' } }],
    });
    const targetTable = await createTable(targetBaseId, {
      name: 'copy identity no directory enrichment target',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Stored user', type: FieldType.User },
      ],
      records: [{ fields: { Title: 'target stored' } }, { fields: { Title: 'target empty' } }],
    });
    const userField = table.fields.find((field) => field.name === 'Stored user')!;
    const storedOnlyUser = { id: 'usr0000000000000001', title: 'Stored-only user' };
    const [schemaName, tableName] = table.dbTableName.split('.');
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} SET ${quoteIdentifier(userField.dbFieldName)} = $1::jsonb WHERE "__id" = $2`,
      JSON.stringify(storedOnlyUser),
      table.records[0].id
    );

    const authorized = await getAuthorizedRecords(axios, table, [userField.id]);
    const authorizedCells = authorized.data.records.map((record) =>
      userIdentityFromAuthorizedCell(record.fields[userField.id])
    );
    expect(authorizedCells[0]).toEqual(storedOnlyUser);
    expect(authorizedCells[0]).not.toHaveProperty('email');
    expect(authorizedCells[1]).toBeUndefined();
    const expectedRaw = authorizedCells.map((cell) => [cell ?? null]);

    const copied = await copyById(
      axios,
      table,
      authorized.data.records.map((record) => record.id),
      [userField.id]
    );
    expect(copied.data.content).toBe('Stored-only user\n');
    expect(copied.data.rawContent).toEqual(expectedRaw);
    expect(copied.data.rawContent?.[0]?.[0]).not.toHaveProperty('email');

    const clipboard = roundTripProductionClipboardHtml(copied.data);
    const targetUserField = targetTable.fields.find((field) => field.name === 'Stored user')!;
    const targetRecordIds = targetTable.records.map((record) => record.id);
    const pasteError = await getError(() =>
      axios.patch(urlBuilder(PASTE_BY_ID_URL, { tableId: targetTable.id }), {
        viewId: targetTable.defaultViewId,
        selection: { recordIds: targetRecordIds, fieldIds: [targetUserField.id] },
        content: clipboard.content,
        header: clipboard.header,
      })
    );
    expect(pasteError?.status).toBe(400);
    expect(pasteError?.data).toMatchObject({
      domainCode: 'validation.field.user_not_found',
    });

    const canonicalTarget = await getAuthorizedRecords(axios, targetTable, [targetUserField.id]);
    expect(
      canonicalTarget.data.records.map((record) => record.fields[targetUserField.id])
    ).toEqual([undefined, undefined]);
    expect(JSON.stringify(canonicalTarget.data.records)).not.toContain(storedOnlyUser.id);
    expect(JSON.stringify(canonicalTarget.data.records)).not.toContain('email');
  });

  it('uses the current shared user projection for rich copy and cross-space paste', async () => {
    const staleEmail = sourceMember.email;
    const currentEmail = `copy-current-${Date.now()}@example.com`;
    const staleSourceMember: UserIdentity = {
      id: sourceMember.id,
      title: sourceMember.name,
      email: staleEmail,
    };
    const storedOnlyUser = { id: 'usr0000000000000002', title: 'Stored-only shared user' };
    const sharedTable = await createTable(sourceBaseId, {
      name: 'shared copy identity projection',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Visible members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
        { name: 'No-email user', type: FieldType.User },
        { name: 'Hidden user', type: FieldType.User },
      ],
      records: [
        {
          fields: {
            Title: 'included',
            'Visible members': [staleSourceMember, owner],
            'Hidden user': owner,
          },
        },
        {
          fields: {
            Title: 'included',
          },
        },
        {
          fields: {
            Title: 'filtered out',
            'Visible members': [owner],
            'Hidden user': owner,
          },
        },
      ],
    });
    const targetTable = await createTable(targetBaseId, {
      name: 'shared copy identity target',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Visible members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
        { name: 'No-email user', type: FieldType.User },
      ],
      records: [{ fields: { Title: 'target first' } }, { fields: { Title: 'target second' } }],
    });
    const titleField = sharedTable.fields.find((field) => field.name === 'Title')!;
    const visibleMembersField = sharedTable.fields.find(
      (field) => field.name === 'Visible members'
    )!;
    const noEmailField = sharedTable.fields.find((field) => field.name === 'No-email user')!;
    const hiddenUserField = sharedTable.fields.find((field) => field.name === 'Hidden user')!;
    const targetVisibleMembersField = targetTable.fields.find(
      (field) => field.name === 'Visible members'
    )!;
    const [sharedSchemaName, sharedTableName] = sharedTable.dbTableName.split('.');
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdentifier(sharedSchemaName)}.${quoteIdentifier(sharedTableName)} SET ${quoteIdentifier(noEmailField.dbFieldName)} = $1::jsonb WHERE "__id" = $2`,
      JSON.stringify(storedOnlyUser),
      sharedTable.records[0].id
    );
    await updateViewColumnMeta(sharedTable.id, sharedTable.defaultViewId!, [
      { fieldId: hiddenUserField.id, columnMeta: { hidden: true } },
    ]);
    await updateViewFilter(sharedTable.id, sharedTable.defaultViewId!, {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: titleField.id, operator: is.value, value: 'included' }],
      },
    });
    const shareId = (
      await enableShareView({ tableId: sharedTable.id, viewId: sharedTable.defaultViewId! })
    ).data.shareId;
    await updateViewShareMeta(sharedTable.id, sharedTable.defaultViewId!, {
      allowCopy: true,
      includeRecords: true,
      includeHiddenField: false,
    });

    const copyParams = {
      projection: [visibleMembersField.id, noEmailField.id, hiddenUserField.id],
      ranges: JSON.stringify([
        [0, 0],
        [2, 1],
      ]),
    };
    const getSharedProjection = async () => {
      const records = await anonymous.get<IRecordsVo>(
        urlBuilder(SHARE_VIEW_RECORDS, { shareId }),
        { params: { take: 10, fieldKeyType: FieldKeyType.Id } }
      );
      expect(records.data.records).toHaveLength(2);
      expect(records.data.records.map((record) => record.fields[titleField.id])).toEqual([
        'included',
        'included',
      ]);
      expect(
        records.data.records.every((record) => !(hiddenUserField.id in record.fields))
      ).toBe(true);

      const rawFromRecords = records.data.records.map((record) => [
        userIdentityFromAuthorizedCell(record.fields[visibleMembersField.id]) ?? null,
        userIdentityFromAuthorizedCell(record.fields[noEmailField.id]) ?? null,
      ]);
      const copied = await anonymous.get<RichCopyVo>(
        urlBuilder(SHARE_VIEW_COPY, { shareId }),
        { params: copyParams }
      );
      expect(copied.data.header.map((field) => field.id)).toEqual([
        visibleMembersField.id,
        noEmailField.id,
      ]);
      expect(copied.data.rawContent).toEqual(rawFromRecords);
      expect(copied.data.rawContent?.[0]?.[1]).toEqual(storedOnlyUser);
      expect(copied.data.rawContent?.[0]?.[1]).not.toHaveProperty('email');
      expect(copied.data.rawContent?.[1]).toEqual([null, null]);
      const singleColumnCopy = await anonymous.get<RichCopyVo>(
        urlBuilder(SHARE_VIEW_COPY, { shareId }),
        {
          params: {
            projection: [visibleMembersField.id],
            ranges: JSON.stringify([
              [0, 0],
              [0, 1],
            ]),
          },
        }
      );
      expect(singleColumnCopy.data.header.map((field) => field.id)).toEqual([
        visibleMembersField.id,
      ]);
      expect(singleColumnCopy.data.rawContent).toEqual(
        rawFromRecords.map(([members]) => [members])
      );
      expect(singleColumnCopy.data.rawContent?.[1]).toEqual([null]);
      return { copied, rawFromRecords, singleColumnCopy };
    };

    const before = await getSharedProjection();
    expect(before.rawFromRecords).toEqual([
      [[staleSourceMember, owner], storedOnlyUser],
      [null, null],
    ]);

    await prisma.user.update({
      where: { id: sourceMember.id },
      data: { email: currentEmail },
    });
    const currentSourceMember: UserIdentity = { ...staleSourceMember, email: currentEmail };
    const after = await getSharedProjection();
    expect(after.rawFromRecords).toEqual([
      [[currentSourceMember, owner], storedOnlyUser],
      [null, null],
    ]);
    expect(JSON.stringify(after.copied.data.rawContent)).not.toContain(staleEmail);

    const clipboard = roundTripProductionClipboardHtml(after.singleColumnCopy.data);
    const targetRecordIds = targetTable.records.map((record) => record.id);
    const paste = await axios.patch<IPasteByIdVo>(
      urlBuilder(PASTE_BY_ID_URL, { tableId: targetTable.id }),
      {
        viewId: targetTable.defaultViewId,
        selection: {
          recordIds: targetRecordIds,
          fieldIds: [targetVisibleMembersField.id],
        },
        content: clipboard.content,
        header: clipboard.header,
      }
    );
    expect(paste.status).toBe(200);
    expect(paste.data.selection).toEqual({
      recordIds: targetRecordIds,
      fieldIds: [targetVisibleMembersField.id],
    });
    const pasted = await getAuthorizedRecords(axios, targetTable, [targetVisibleMembersField.id]);
    expect(
      pasted.data.records.map((record) =>
        userIdentityFromAuthorizedCell(record.fields[targetVisibleMembersField.id])
      )
    ).toEqual([after.rawFromRecords[0][0], undefined]);
    expect(JSON.stringify(pasted.data.records)).not.toContain(staleEmail);

    await updateViewShareMeta(sharedTable.id, sharedTable.defaultViewId!, {
      allowCopy: true,
      includeRecords: false,
      includeHiddenField: false,
    });
    const recordsDisabled = await anonymous.get<RichCopyVo>(
      urlBuilder(SHARE_VIEW_COPY, { shareId }),
      { params: copyParams }
    );
    expect(recordsDisabled.data.content).toBe('');
    expect(recordsDisabled.data.header.map((field) => field.id)).toEqual([
      visibleMembersField.id,
      noEmailField.id,
    ]);
    expect(recordsDisabled.data.rawContent ?? []).toEqual([]);

    await updateViewShareMeta(sharedTable.id, sharedTable.defaultViewId!, {
      allowCopy: false,
      includeRecords: true,
      includeHiddenField: false,
    });
    const copyDenied = await getError(() =>
      anonymous.get<RichCopyVo>(urlBuilder(SHARE_VIEW_COPY, { shareId }), {
        params: copyParams,
      })
    );
    expect(copyDenied?.status).toBe(403);
  });
});

describe('V1 shared user projection over real HTTP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let anonymous: AxiosInstance;
  let sourceSpaceId: string;
  let targetSpaceId: string;
  let sourceBaseId: string;
  let targetBaseId: string;
  let sourceMember: IUserMeVo;
  let previousForceV2All: string | undefined;
  let previousEnableCanaryFeature: string | undefined;

  const owner: UserIdentity = {
    id: globalThis.testConfig.userId,
    title: globalThis.testConfig.userName,
    email: globalThis.testConfig.email,
  };

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    // A V1 share requires both the boot-time force flag and rollout flag off; a
    // base with v2Enabled=true still wins, so the fixture base is explicitly V1.
    process.env.FORCE_V2_ALL = 'false';
    process.env.ENABLE_CANARY_FEATURE = 'false';

    const appContext = await initApp();
    app = appContext.app;
    prisma = app.get(PrismaService);
    anonymous = createAnonymousUserAxios(appContext.appUrl);
    sourceSpaceId = (await createSpace({ name: `copy-v1-source-${Date.now()}` })).id;
    targetSpaceId = (await createSpace({ name: `copy-v1-target-${Date.now()}` })).id;
    sourceBaseId = (await createBase({ spaceId: sourceSpaceId, name: 'copy v1 source' })).id;
    targetBaseId = (await createBase({ spaceId: targetSpaceId, name: 'copy v1 target' })).id;
    await prisma.base.updateMany({
      where: { id: { in: [sourceBaseId, targetBaseId] } },
      data: { v2Enabled: false },
    });

    const sourceMemberEmail = `copy-v1-member-${Date.now()}@example.com`;
    const sourceMemberClient = await createNewUserAxios({
      email: sourceMemberEmail,
      password: '12345678',
    });
    sourceMember = (await sourceMemberClient.get<IUserMeVo>(USER_ME)).data;
    await emailSpaceInvitation({
      spaceId: sourceSpaceId,
      emailSpaceInvitationRo: { emails: [sourceMemberEmail], role: Role.Editor },
    });
    const targetMembership = await getSpaceCollaboratorList(targetSpaceId, {
      type: PrincipalType.User,
      principalId: sourceMember.id,
    });
    expect(targetMembership.data.collaborators).toEqual([]);
  });

  afterAll(async () => {
    if (sourceSpaceId) {
      await permanentDeleteSpace(sourceSpaceId).catch(() => undefined);
    }
    if (targetSpaceId) {
      await permanentDeleteSpace(targetSpaceId).catch(() => undefined);
    }
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    if (previousEnableCanaryFeature === undefined) {
      delete process.env.ENABLE_CANARY_FEATURE;
    } else {
      process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
    }
    await app?.close();
  });

  it('round-trips a normal V1 copy through production clipboard HTML and paste-by-id', async () => {
    const sourceIdentity: UserIdentity = {
      id: sourceMember.id,
      title: sourceMember.name,
      email: sourceMember.email,
    };
    const sourceTable = await createTable(sourceBaseId, {
      name: 'v1 normal copy identity source',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Owner', type: FieldType.User },
        {
          name: 'Members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      records: [
        { fields: { Title: 'first', Owner: sourceIdentity, Members: [sourceIdentity, owner] } },
        { fields: { Title: 'second', Owner: owner, Members: [sourceIdentity] } },
      ],
    });
    const targetTable = await createTable(targetBaseId, {
      name: 'v1 normal copy identity target',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Owner', type: FieldType.User },
        {
          name: 'Members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
      ],
      records: [{ fields: { Title: 'target first' } }, { fields: { Title: 'target second' } }],
    });
    const sourceFieldIds = sourceTable.fields
      .filter((field) => field.name === 'Owner' || field.name === 'Members')
      .map((field) => field.id);
    const targetFieldIds = targetTable.fields
      .filter((field) => field.name === 'Owner' || field.name === 'Members')
      .map((field) => field.id);
    const v1Headers = { [X_CANARY_HEADER]: 'false' };
    const sourceRecords = await axios.get<IRecordsVo>(
      urlBuilder(GET_RECORDS_URL, { tableId: sourceTable.id }),
      {
        params: {
          viewId: sourceTable.defaultViewId,
          fieldKeyType: FieldKeyType.Id,
          projection: sourceFieldIds,
        },
        headers: v1Headers,
      }
    );
    expect(sourceRecords.headers['x-teable-v2']).toBe('false');
    const expectedRaw = sourceRecords.data.records.map((record) =>
      sourceFieldIds.map((fieldId) => userIdentityFromAuthorizedCell(record.fields[fieldId]))
    );

    const copied = await axios.get<RichCopyVo>(urlBuilder(COPY_URL, { tableId: sourceTable.id }), {
      params: {
        viewId: sourceTable.defaultViewId,
        projection: sourceFieldIds,
        ranges: JSON.stringify([
          [0, 0],
          [1, 1],
        ]),
      },
      headers: v1Headers,
    });
    expect(copied.status).toBe(200);
    expect(copied.headers['x-teable-v2']).toBe('false');
    expect(copied.data.header.map((field) => field.id)).toEqual(sourceFieldIds);
    expect(copied.data.rawContent).toEqual(expectedRaw);

    const clipboard = roundTripProductionClipboardHtml(copied.data);
    const targetRecordIds = targetTable.records.map((record) => record.id);
    const paste = await axios.patch<IPasteByIdVo>(
      urlBuilder(PASTE_BY_ID_URL, { tableId: targetTable.id }),
      {
        viewId: targetTable.defaultViewId,
        selection: { recordIds: targetRecordIds, fieldIds: targetFieldIds },
        content: clipboard.content,
        header: clipboard.header,
      },
      { headers: v1Headers }
    );
    expect(paste.status).toBe(200);
    expect(paste.headers['x-teable-v2']).toBe('false');
    expect(paste.data.selection).toEqual({ recordIds: targetRecordIds, fieldIds: targetFieldIds });

    const canonicalTarget = await axios.get<IRecordsVo>(
      urlBuilder(GET_RECORDS_URL, { tableId: targetTable.id }),
      {
        params: {
          viewId: targetTable.defaultViewId,
          fieldKeyType: FieldKeyType.Id,
          projection: targetFieldIds,
        },
        headers: v1Headers,
      }
    );
    expect(canonicalTarget.headers['x-teable-v2']).toBe('false');
    expect(
      canonicalTarget.data.records.map((record) =>
        targetFieldIds.map((fieldId) => userIdentityFromAuthorizedCell(record.fields[fieldId]))
      )
    ).toEqual(expectedRaw);
  });

  it('copies the exact V1 shared projection and pastes the valid stored pair across spaces', async () => {
    const staleEmail = sourceMember.email;
    const currentEmail = `copy-v1-current-${Date.now()}@example.com`;
    const staleSourceMember: UserIdentity = {
      id: sourceMember.id,
      title: sourceMember.name,
      email: staleEmail,
    };
    const storedOnlyUser = { id: 'usr0000000000000003', title: 'Stored-only V1 shared user' };
    const sharedTable = await createTable(sourceBaseId, {
      name: 'v1 shared copy identity projection',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Visible members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
        { name: 'No-email user', type: FieldType.User },
        { name: 'Hidden user', type: FieldType.User },
      ],
      records: [
        {
          fields: {
            Title: 'included',
            'Visible members': [staleSourceMember, owner],
            'Hidden user': owner,
          },
        },
        {
          fields: {
            Title: 'filtered out',
            'Visible members': [owner],
            'Hidden user': owner,
          },
        },
      ],
    });
    const targetTable = await createTable(targetBaseId, {
      name: 'v1 shared copy identity target',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        {
          name: 'Visible members',
          type: FieldType.User,
          options: { isMultiple: true, shouldNotify: false },
        },
        { name: 'No-email user', type: FieldType.User },
      ],
      records: [{ fields: { Title: 'target' } }],
    });
    const titleField = sharedTable.fields.find((field) => field.name === 'Title')!;
    const visibleMembersField = sharedTable.fields.find(
      (field) => field.name === 'Visible members'
    )!;
    const noEmailField = sharedTable.fields.find((field) => field.name === 'No-email user')!;
    const hiddenUserField = sharedTable.fields.find((field) => field.name === 'Hidden user')!;
    const targetVisibleMembersField = targetTable.fields.find(
      (field) => field.name === 'Visible members'
    )!;
    const [schemaName, tableName] = sharedTable.dbTableName.split('.');
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} SET ${quoteIdentifier(visibleMembersField.dbFieldName)} = $1::jsonb, ${quoteIdentifier(noEmailField.dbFieldName)} = $2::jsonb WHERE "__id" = $3`,
      JSON.stringify([{ id: sourceMember.id }, owner]),
      JSON.stringify(storedOnlyUser),
      sharedTable.records[0].id
    );
    await updateViewColumnMeta(sharedTable.id, sharedTable.defaultViewId!, [
      { fieldId: hiddenUserField.id, columnMeta: { hidden: true } },
    ]);
    await updateViewFilter(sharedTable.id, sharedTable.defaultViewId!, {
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: titleField.id, operator: is.value, value: 'included' }],
      },
    });
    const shareId = (
      await enableShareView({ tableId: sharedTable.id, viewId: sharedTable.defaultViewId! })
    ).data.shareId;
    await updateViewShareMeta(sharedTable.id, sharedTable.defaultViewId!, {
      allowCopy: true,
      includeRecords: true,
      includeHiddenField: false,
    });
    const projection = [visibleMembersField.id, noEmailField.id, hiddenUserField.id];
    const copyParams = {
      projection,
      ranges: JSON.stringify([
        [0, 0],
        [2, 0],
      ]),
    };
    const getSharedProjection = async () => {
      const records = await anonymous.get<IRecordsVo>(
        urlBuilder(SHARE_VIEW_RECORDS, { shareId }),
        { params: { take: 10, fieldKeyType: FieldKeyType.Id, projection } }
      );
      expect(records.headers['x-teable-v2']).toBe('false');
      expect(records.data.records).toHaveLength(1);
      expect(records.data.records[0].fields).not.toHaveProperty(hiddenUserField.id);
      const rawFromRecords = [
        [
          userIdentityFromAuthorizedCell(
            records.data.records[0].fields[visibleMembersField.id]
          ),
          userIdentityFromAuthorizedCell(records.data.records[0].fields[noEmailField.id]),
        ],
      ];

      const copied = await anonymous.get<RichCopyVo>(
        urlBuilder(SHARE_VIEW_COPY, { shareId }),
        { params: copyParams }
      );
      expect(copied.headers['x-teable-v2']).toBe('false');
      expect(copied.data.header.map((field) => field.id)).toEqual([
        visibleMembersField.id,
        noEmailField.id,
      ]);
      expect(copied.data.rawContent).toEqual(rawFromRecords);
      expect(copied.data.rawContent?.[0]?.[1]).toEqual(storedOnlyUser);
      expect(copied.data.rawContent?.[0]?.[1]).not.toHaveProperty('email');
      return { copied, rawFromRecords };
    };
    const before = await getSharedProjection();
    expect(before.rawFromRecords).toEqual([[[staleSourceMember, owner], storedOnlyUser]]);
    const clipboard = roundTripProductionClipboardHtml(before.copied.data);
    const targetRecordIds = targetTable.records.map((record) => record.id);
    const paste = await axios.patch<IPasteByIdVo>(
      urlBuilder(PASTE_BY_ID_URL, { tableId: targetTable.id }),
      {
        viewId: targetTable.defaultViewId,
        selection: {
          recordIds: targetRecordIds,
          fieldIds: [targetVisibleMembersField.id],
        },
        content: [[clipboard.content[0][0]]],
        header: [clipboard.header[0]],
      },
      { headers: { [X_CANARY_HEADER]: 'false' } }
    );
    expect(paste.status).toBe(200);
    expect(paste.headers['x-teable-v2']).toBe('false');
    expect(paste.data.selection).toEqual({
      recordIds: targetRecordIds,
      fieldIds: [targetVisibleMembersField.id],
    });
    const pasted = await axios.get<IRecordsVo>(
      urlBuilder(GET_RECORDS_URL, { tableId: targetTable.id }),
      {
        params: {
          viewId: targetTable.defaultViewId,
          fieldKeyType: FieldKeyType.Id,
          projection: [targetVisibleMembersField.id],
        },
      }
    );
    expect(
      pasted.data.records.map((record) =>
        userIdentityFromAuthorizedCell(record.fields[targetVisibleMembersField.id])
      )
    ).toEqual([before.rawFromRecords[0][0]]);

    await prisma.user.update({ where: { id: sourceMember.id }, data: { email: currentEmail } });
    // A known stored id without title/email is hydrated by V1 public records;
    // rich copy must use that same authorized projection after directory changes.
    const currentSourceMember: UserIdentity = { ...staleSourceMember, email: currentEmail };
    const after = await getSharedProjection();
    expect(after.rawFromRecords).toEqual([[[currentSourceMember, owner], storedOnlyUser]]);
  });
});

describe.each(['V2', 'V1'] as const)('%s shared copy snapshot races over real HTTP (e2e)', (version) => {
  let app: INestApplication;
  let anonymous: AxiosInstance;
  let spaceId: string;
  let baseId: string;
  let secretUser: UserIdentity & { email: string };
  let previousForceV2All: string | undefined;
  let previousEnableCanaryFeature: string | undefined;

  const initialUser: UserIdentity = {
    id: globalThis.testConfig.userId,
    title: globalThis.testConfig.userName,
    email: globalThis.testConfig.email,
  };

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    process.env.FORCE_V2_ALL = String(version === 'V2');
    process.env.ENABLE_CANARY_FEATURE = 'false';
    const appContext = await initApp();
    app = appContext.app;
    anonymous = createAnonymousUserAxios(appContext.appUrl);
    spaceId = (await createSpace({ name: `copy-race-${version}-${Date.now()}` })).id;
    baseId = (await createBase({ spaceId, name: `copy race ${version}` })).id;
    await app.get(PrismaService).base.update({
      where: { id: baseId },
      data: { v2Enabled: version === 'V2' },
    });

    const email = `copy-race-undisclosed-${version.toLowerCase()}-${Date.now()}@example.com`;
    const client = await createNewUserAxios({ email, password: '12345678' });
    const user = (await client.get<IUserMeVo>(USER_ME)).data;
    secretUser = { id: user.id, title: user.name, email: user.email };
    await emailSpaceInvitation({
      spaceId,
      emailSpaceInvitationRo: { emails: [email], role: Role.Editor },
    });
  });

  afterAll(async () => {
    if (spaceId) await permanentDeleteSpace(spaceId).catch(() => undefined);
    if (previousForceV2All === undefined) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
    if (previousEnableCanaryFeature === undefined) {
      delete process.env.ENABLE_CANARY_FEATURE;
    } else {
      process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
    }
    await app?.close();
  });

  it.each([
    'value remains visible',
    'field becomes hidden',
    'allowCopy becomes false',
    'includeRecords becomes false',
    'view filter excludes the row',
  ] as const)('does not mix the authorized old snapshot with a newer user when %s', async (change) => {
    const table = await createTable(baseId, {
      name: `copy race ${change}`,
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Member', type: FieldType.User, options: { shouldNotify: false } },
      ],
      records: [
        { fields: { Title: 'included', Member: initialUser } },
        { fields: { Title: 'excluded' } },
      ],
    });
    const titleField = table.fields.find((field) => field.name === 'Title')!;
    const userField = table.fields.find((field) => field.name === 'Member')!;
    const viewId = table.defaultViewId!;
    const recordId = table.records[0].id;
    const filterFor = (value: string) => ({
      conjunction: 'and' as const,
      filterSet: [{ fieldId: titleField.id, operator: is.value, value }],
    });
    await updateViewFilter(table.id, viewId, { filter: filterFor('included') });
    const shareId = (await enableShareView({ tableId: table.id, viewId })).data.shareId;
    await updateViewShareMeta(table.id, viewId, {
      allowCopy: true,
      includeRecords: true,
      includeHiddenField: false,
    });
    const copyParams = {
      projection: [userField.id],
      ranges: JSON.stringify([
        [0, 0],
        [0, 0],
      ]),
    };
    const copyUrl = urlBuilder(SHARE_VIEW_COPY, { shareId });
    const recordsUrl = urlBuilder(SHARE_VIEW_RECORDS, { shareId });
    const authorizedBefore = await anonymous.get<IRecordsVo>(recordsUrl);
    expect(authorizedBefore.headers['x-teable-v2']).toBe(String(version === 'V2'));
    expect(authorizedBefore.data.records.map((record) => record.id)).toEqual([recordId]);
    expect(
      userIdentityFromAuthorizedCell(authorizedBefore.data.records[0].fields[userField.id])
    ).toEqual(initialUser);
    expect(JSON.stringify(authorizedBefore.data)).not.toContain(secretUser.id);

    type InitialSelection = { fieldIds: string[]; recordIds: string[]; rawContent: unknown[][] };
    const { promise: entered, resolve: enter } = Promise.withResolvers<InitialSelection>();
    const { promise: resume, resolve: release } = Promise.withResolvers<void>();
    let paused = false;
    let restore: () => void;

    // These pass-through barriers return the real first selection unchanged.
    // They stop after its authorization and record read, before the HTTP adapter
    // can re-read cells using the now-stale field/record selection. Removing that
    // second read must not remove the barrier or weaken the regression.
    if (version === 'V2') {
      const original = GetViewSelectionCopyHandler.prototype.handle;
      const spy = vi.spyOn(GetViewSelectionCopyHandler.prototype, 'handle').mockImplementation(
        async function (this: GetViewSelectionCopyHandler, context, query) {
          const result = await original.call(this, context, query);
          if (query.tableId.toString() === table.id && !paused && result.isOk()) {
            paused = true;
            enter({
              fieldIds: result.value.fields.map((field) => field.id().toString()),
              recordIds: result.value.sourceRecords.map((record) => record.id),
              rawContent: result.value.sourceRecords.map((record) =>
                result.value.fields.map((field) => record.fields[field.id().toString()])
              ),
            });
            await resume;
          }
          return result;
        }
      );
      restore = () => spy.mockRestore();
    } else {
      const recordService = app.get(RecordService);
      const original = recordService.getRecordsFields.bind(recordService);
      const spy = vi.spyOn(recordService, 'getRecordsFields').mockImplementation(async (...args) => {
        const records = await original(...args);
        if (args[0] === table.id && !paused) {
          paused = true;
          enter({
            fieldIds: args[1].projection ?? [],
            recordIds: records.map((record) => record.id),
            rawContent: records.map((record) => [record.fields[userField.id]]),
          });
          await resume;
        }
        return records;
      });
      restore = () => spy.mockRestore();
    }

    const { promise: barrierDeadline, reject: rejectBarrier } = Promise.withResolvers<never>();
    const barrierTimeout = setTimeout(
      () => rejectBarrier(new Error('First copy read was not reached')),
      15_000
    );
    const copyRequest = anonymous.get<RichCopyVo>(copyUrl, {
      params: copyParams,
      timeout: 30_000,
      validateStatus: () => true,
    });
    try {
      const firstSelection = await Promise.race([
        entered,
        copyRequest.then((response) => {
          throw new Error(`Copy returned HTTP ${response.status} without reaching its first read`);
        }),
        barrierDeadline,
      ]);
      clearTimeout(barrierTimeout);
      expect(firstSelection.fieldIds).toEqual([userField.id]);
      expect(firstSelection.recordIds).toEqual([recordId]);
      expect(firstSelection.rawContent.map((row) => row.map(userIdentityFromAuthorizedCell))).toEqual([
        [initialUser],
      ]);
      expect(JSON.stringify(firstSelection)).not.toContain(secretUser.id);

      // All mutations are owner-authenticated HTTP requests, not mocked policy
      // or record results. Revoke scope before writing the previously unseen B.
      if (change === 'field becomes hidden') {
        await updateViewColumnMeta(table.id, viewId, [
          { fieldId: userField.id, columnMeta: { hidden: true } },
        ]);
      } else if (change === 'allowCopy becomes false') {
        await updateViewShareMeta(table.id, viewId, { allowCopy: false });
      } else if (change === 'includeRecords becomes false') {
        await updateViewShareMeta(table.id, viewId, { includeRecords: false });
      } else if (change === 'view filter excludes the row') {
        await updateViewFilter(table.id, viewId, { filter: filterFor('excluded') });
      }
      const updated = await updateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Id,
        record: { fields: { [userField.id]: secretUser } },
      });
      expect(userIdentityFromAuthorizedCell(updated.fields[userField.id])).toEqual(secretUser);

      if (change === 'allowCopy becomes false') {
        const denied = await anonymous.get(copyUrl, {
          params: copyParams,
          validateStatus: () => true,
        });
        expect(denied.status).toBe(403);
      } else {
        const current = await anonymous.get<IRecordsVo>(recordsUrl);
        if (change === 'value remains visible') {
          expect(userIdentityFromAuthorizedCell(current.data.records[0].fields[userField.id])).toEqual(
            secretUser
          );
        } else {
          expect(JSON.stringify(current.data)).not.toContain(secretUser.id);
          if (change === 'field becomes hidden') {
            expect(current.data.records[0].fields).not.toHaveProperty(userField.id);
          } else if (change === 'includeRecords becomes false') {
            expect(current.data.records).toEqual([]);
          } else {
            expect(current.data.records.map((record) => record.id)).toEqual([table.records[1].id]);
          }
        }
      }

      release();
      const response = await copyRequest;
      const payload = JSON.stringify(response.data);
      expect
        .soft(payload, 'Copy must not disclose the user written after the authorized first read')
        .not.toContain(secretUser.id);
      expect.soft(payload).not.toContain(secretUser.email);
      expect.soft(payload).not.toContain(secretUser.title);
      if (response.status === 200 && response.data.content !== '') {
        expect(response.headers['x-teable-v2']).toBe(String(version === 'V2'));
        expect.soft(response.data.content).toBe(initialUser.title);
        expect.soft(response.data.header.map((field) => field.id)).toEqual([userField.id]);
        expect.soft(response.data.rawContent).toEqual([[initialUser]]);
      } else if (response.status === 200) {
        expect(response.data.rawContent ?? []).toEqual([]);
      } else {
        // The operation may fail closed, but a server error is not a privacy fix.
        expect([403, 404]).toContain(response.status);
      }
    } finally {
      clearTimeout(barrierTimeout);
      release();
      await copyRequest.catch(() => undefined);
      restore();
    }
  });
});
