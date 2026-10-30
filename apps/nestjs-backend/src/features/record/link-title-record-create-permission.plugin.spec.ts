import { APP_ROBOT_ID, HttpErrorCode, SYSTEM_USER_ID } from '@teable/core';
import {
  PostgresTableRowLimitPlugin,
  StaticTableRowLimitPolicy,
} from '@teable/v2-adapter-repository-postgres';
import {
  ActorId,
  BaseId,
  DefaultTableMapper,
  FieldId,
  FieldKeyType,
  FieldName,
  ok,
  RecordWriteOperationKind,
  RecordWritePluginRunner,
  RecordWriteSideEffectService,
  SelectOption,
  Table,
  TableId,
  TableName,
  type RecordWritePluginContextMap,
  type TableRecord,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';
import { RecordBatchCreationService } from '../../../../../packages/v2/core/src/application/services/RecordBatchCreationService';
import { CustomHttpException } from '../../custom.exception';
import { LinkTitleRecordCreatePermissionPlugin } from './link-title-record-create-permission.plugin';

const TARGET_ID = `tbl${'t'.repeat(16)}`;
const SOURCE_ID = `tbl${'s'.repeat(16)}`;
const FIELD_ID = `fld${'f'.repeat(16)}`;
const USER_ID = `usr${'u'.repeat(16)}`;
const TOKEN_ID = `tkn${'p'.repeat(16)}`;
const BASE_ID = `bse${'b'.repeat(16)}`;
const SOURCE_BASE_ID = `bse${'s'.repeat(16)}`;
const TARGET_BASE_ID = `bse${'t'.repeat(16)}`;

const context = (actorId = USER_ID): RecordWritePluginContextMap['createMany'] => ({
  kind: RecordWriteOperationKind.createMany,
  executionContext: { actorId: ActorId.create(actorId)._unsafeUnwrap() },
  table: {
    id: () => TableId.create(TARGET_ID)._unsafeUnwrap(),
    baseId: () => BaseId.create(TARGET_BASE_ID)._unsafeUnwrap(),
  } as never,
  payload: {
    recordsFieldValues: [new Map([[FIELD_ID, 'Missing title']])],
    fieldKeyType: FieldKeyType.Id,
    typecast: true,
    recordCount: 1,
    linkTitleSource: {
      baseId: BaseId.create(SOURCE_BASE_ID)._unsafeUnwrap(),
      tableId: TableId.create(SOURCE_ID)._unsafeUnwrap(),
      fieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
    },
  },
  isTransactionBound: true,
});

const createPlugin = (values: Record<string, unknown> = {}, hostPolicy = false) => {
  const clsValues: Record<string, unknown> = { 'user.id': USER_ID, ...values };
  const permissions = {
    validPermissions: vi.fn().mockResolvedValue(['record|create']),
    getPermissionsByAccessToken: vi.fn().mockResolvedValue(['record|create']),
    validShareViewPermissions: vi.fn().mockResolvedValue(['record|create']),
    validBaseSharePermissions: vi.fn().mockResolvedValue(['record|create']),
    validTemplatePermissions: vi.fn().mockResolvedValue(['record|read']),
  };
  const targetSchemaCapability = {
    canManageTargetSchema: vi.fn().mockResolvedValue(ok<boolean>(true)),
  };
  const recordWriteSideEffectService = {
    wouldUpdateTableMetadata: vi.fn().mockReturnValue(ok<boolean>(false)),
  };
  const plugin = new LinkTitleRecordCreatePermissionPlugin(
    permissions as never,
    { get: (key: string) => clsValues[key] } as never,
    hostPolicy,
    targetSchemaCapability as never,
    recordWriteSideEffectService as never
  );
  return { plugin, permissions, targetSchemaCapability, recordWriteSideEffectService };
};

const denial = () =>
  new CustomHttpException('Target create is denied', HttpErrorCode.RESTRICTED_RESOURCE, {
    localization: { i18nKey: 'httpErrors.permission.notAllowedOperation' },
  });

describe('LinkTitleRecordCreatePermissionPlugin', () => {
  describe.each([false, true])('row-limit plugin registered first=%s', (rowLimitFirst) => {
    it.each([
      { titles: ['Existing', 'New'], allowed: true },
      { titles: ['New', 'Existing'], allowed: false },
    ])('authorizes only the surviving title in $titles', async ({ titles, allowed }) => {
      const builder = Table.builder()
        .withId(TableId.create(TARGET_ID)._unsafeUnwrap())
        .withBaseId(BaseId.create(TARGET_BASE_ID)._unsafeUnwrap())
        .withName(TableName.create('Target')._unsafeUnwrap());
      builder
        .field()
        .singleSelect()
        .withId(FieldId.create(FIELD_ID)._unsafeUnwrap())
        .withName(FieldName.create('Status')._unsafeUnwrap())
        .withOptions([SelectOption.create({ name: 'Existing', color: 'blue' })._unsafeUnwrap()])
        .primary()
        .done();
      builder.view().defaultGrid().done();
      const table = builder.build()._unsafeUnwrap();
      const { plugin, targetSchemaCapability, recordWriteSideEffectService } = createPlugin();
      targetSchemaCapability.canManageTargetSchema.mockResolvedValue(ok(false));
      const probeService = new RecordWriteSideEffectService();
      recordWriteSideEffectService.wouldUpdateTableMetadata.mockImplementation(
        probeService.wouldUpdateTableMetadata.bind(probeService)
      );
      const executor = {
        transformQuery: (node: unknown) => node,
        compileQuery: () => ({ sql: '', parameters: [], query: { kind: 'RawNode' } }),
        executeQuery: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
      };
      const rowLimitPlugin = new PostgresTableRowLimitPlugin(
        { getExecutor: () => executor } as never,
        new StaticTableRowLimitPolicy(1)
      );
      const runner = new RecordWritePluginRunner(
        rowLimitFirst ? [rowLimitPlugin, plugin] : [plugin, rowLimitPlugin],
        { error: vi.fn() } as never,
        new DefaultTableMapper()
      );
      const sideEffectService = new RecordWriteSideEffectService();
      const executeSideEffects = vi.spyOn(sideEffectService, 'execute');
      const insertMany = vi.fn(
        async (_context: unknown, _table: unknown, records: ReadonlyArray<TableRecord>) =>
          ok({
            recordSnapshots: records.map((record) => ({
              recordId: record.id().toString(),
              fields: Object.fromEntries(
                Array.from(record.fields().entries(), (entry) => [
                  entry.fieldId.toString(),
                  entry.value.toValue(),
                ])
              ),
            })),
          })
      );
      const tableUpdateFlow = { execute: vi.fn().mockResolvedValue(ok({ events: [] })) };
      const service = new RecordBatchCreationService(
        { insertMany } as never,
        {
          resolveAndReplaceMany: async (_context: unknown, specs: ReadonlyArray<unknown>) =>
            ok(specs),
        } as never,
        { decorateChangedFieldsByRecord: async () => ok(undefined) } as never,
        runner,
        sideEffectService,
        {
          captureSelectOptionSideEffects: async () => ok({ undoCommands: [], redoCommands: [] }),
        } as never,
        tableUpdateFlow as never
      );
      const nested = context();

      const result = await service.create(nested.executionContext, {
        table,
        recordsFieldValues: titles.map((title) => new Map([[FIELD_ID, title]])),
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        isTransactionBound: true,
        linkTitleSource: nested.payload.linkTitleSource,
      });

      expect(tableUpdateFlow.execute).not.toHaveBeenCalled();
      if (allowed) {
        expect(result._unsafeUnwrap().records).toHaveLength(1);
        expect(insertMany).toHaveBeenCalledOnce();
        const insertedRecord = insertMany.mock.calls[0]?.[2][0];
        expect(insertedRecord?.displayName(table)._unsafeUnwrap()).toBe('Existing');
        expect(executeSideEffects).toHaveBeenCalledOnce();
        expect(targetSchemaCapability.canManageTargetSchema).not.toHaveBeenCalled();
      } else {
        expect(result._unsafeUnwrapErr()).toMatchObject({
          code: 'link_title.record_create_forbidden',
          tags: expect.arrayContaining(['forbidden']),
        });
        expect(targetSchemaCapability.canManageTargetSchema).toHaveBeenCalledOnce();
        expect(executeSideEffects).not.toHaveBeenCalled();
        expect(insertMany).not.toHaveBeenCalled();
      }
    });
  });

  it('checks the actual target, not the source or cached HTTP permissions', async () => {
    const { plugin, permissions } = createPlugin({ permissions: ['record|create'] });
    permissions.validPermissions.mockRejectedValue(denial());

    const result = await plugin.prepare(context());

    expect(permissions.validPermissions).toHaveBeenCalledWith(TARGET_ID, ['record|create']);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'link_title.record_create_forbidden',
      tags: expect.arrayContaining(['forbidden']),
      details: { tableId: TARGET_ID, sourceTableId: SOURCE_ID, sourceFieldId: FIELD_ID },
      localization: { i18nKey: 'httpErrors.permission.notAllowedOperation' },
    });
  });

  it('allows the target role to grant create', async () => {
    const { plugin, permissions } = createPlugin();
    expect((await plugin.prepare(context())).isOk()).toBe(true);
    expect(permissions.validPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not impose new permissions on direct createMany, seeds, duplication or upsert', async () => {
    const { plugin, permissions } = createPlugin({ accessTokenId: TOKEN_ID });
    const direct = context();
    const payload = { ...direct.payload, linkTitleSource: undefined };
    expect((await plugin.prepare({ ...direct, payload })).isOk()).toBe(true);
    expect(permissions.validPermissions).not.toHaveBeenCalled();
    expect(permissions.getPermissionsByAccessToken).not.toHaveBeenCalled();
    expect(plugin.supports(RecordWriteOperationKind.createMany)).toBe(true);
    expect(plugin.supports(RecordWriteOperationKind.paste)).toBe(false);
    expect(plugin.supports(RecordWriteOperationKind.upsertRecords)).toBe(false);
  });

  it('requires field update on the actual foreign target when a select option would be added', async () => {
    const { plugin, targetSchemaCapability, recordWriteSideEffectService } = createPlugin({
      accessTokenId: TOKEN_ID,
    });
    recordWriteSideEffectService.wouldUpdateTableMetadata.mockReturnValue(ok(true));
    targetSchemaCapability.canManageTargetSchema.mockResolvedValue(ok(false));
    const nested = context();

    expect((await plugin.prepare(nested)).isOk()).toBe(true);
    expect(recordWriteSideEffectService.wouldUpdateTableMetadata).not.toHaveBeenCalled();
    const result = await plugin.afterGuard(nested);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'link_title.record_create_forbidden',
      tags: expect.arrayContaining(['forbidden']),
      details: { tableId: TARGET_ID, sourceBaseId: SOURCE_BASE_ID },
    });
    expect(targetSchemaCapability.canManageTargetSchema).toHaveBeenCalledWith(
      nested.table,
      nested.executionContext.actorId,
      undefined,
      'field|update',
      TOKEN_ID
    );
  });

  it('uses the target field grant instead of the source cached option flag', async () => {
    const { plugin, targetSchemaCapability, recordWriteSideEffectService } = createPlugin();
    recordWriteSideEffectService.wouldUpdateTableMetadata.mockReturnValue(ok(true));
    const nested = context();
    nested.executionContext.config = { allowSelectOptionAutoCreate: false };

    expect((await plugin.prepare(nested)).isOk()).toBe(true);
    expect((await plugin.afterGuard(nested)).isOk()).toBe(true);
    expect(targetSchemaCapability.canManageTargetSchema).toHaveBeenCalledOnce();
    expect(nested.executionContext.config.allowSelectOptionAutoCreate).toBe(true);
    expect(recordWriteSideEffectService.wouldUpdateTableMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ allowSelectOptionAutoCreate: undefined }),
      }),
      nested.table,
      nested.payload.recordsFieldValues,
      true
    );
  });

  it('keeps robot select-option writes inside the actual temporary target scope', async () => {
    const { plugin, permissions, targetSchemaCapability, recordWriteSideEffectService } =
      createPlugin({ 'user.id': APP_ROBOT_ID, tempAuthBaseId: BASE_ID }, true);
    recordWriteSideEffectService.wouldUpdateTableMetadata.mockReturnValue(ok(true));

    const nested = context(APP_ROBOT_ID);
    expect((await plugin.prepare(nested)).isOk()).toBe(true);
    expect((await plugin.afterGuard(nested)).isOk()).toBe(true);
    expect(permissions.validPermissions).toHaveBeenNthCalledWith(1, TARGET_ID, ['record|create']);
    expect(permissions.validPermissions).toHaveBeenNthCalledWith(
      2,
      TARGET_ID,
      ['field|update'],
      undefined
    );
    expect(targetSchemaCapability.canManageTargetSchema).not.toHaveBeenCalled();
  });

  it('does not require target field update when no select option would be added', async () => {
    const { plugin, targetSchemaCapability } = createPlugin();
    const nested = context();
    expect((await plugin.prepare(nested)).isOk()).toBe(true);
    expect((await plugin.afterGuard(nested)).isOk()).toBe(true);
    expect(targetSchemaCapability.canManageTargetSchema).not.toHaveBeenCalled();
  });

  it('keeps delegated share scope as the target select-option ceiling', async () => {
    const { plugin, permissions, targetSchemaCapability, recordWriteSideEffectService } =
      createPlugin({ shareViewId: 'shr-view' }, true);
    recordWriteSideEffectService.wouldUpdateTableMetadata.mockReturnValue(ok(true));

    const nested = context();
    expect((await plugin.prepare(nested)).isOk()).toBe(true);
    expect((await plugin.afterGuard(nested)).isOk()).toBe(true);
    expect(permissions.validShareViewPermissions).toHaveBeenNthCalledWith(
      1,
      'shr-view',
      TARGET_ID,
      ['record|create']
    );
    expect(permissions.validShareViewPermissions).toHaveBeenNthCalledWith(
      2,
      'shr-view',
      TARGET_ID,
      ['field|update']
    );
    expect(targetSchemaCapability.canManageTargetSchema).not.toHaveBeenCalled();
  });

  it('keeps a same-table link-title creation subject to create permission', async () => {
    const { plugin, permissions } = createPlugin();
    const nested = context();
    expect(
      (
        await plugin.prepare({
          ...nested,
          payload: {
            ...nested.payload,
            linkTitleSource: {
              baseId: nested.table.baseId(),
              tableId: nested.table.id(),
              fieldId: FieldId.create(FIELD_ID)._unsafeUnwrap(),
            },
          },
        })
      ).isOk()
    ).toBe(true);
    expect(permissions.validPermissions).toHaveBeenCalledWith(TARGET_ID, ['record|create']);
  });

  it.each([false, true])(
    'enforces the PAT create ceiling with host policy=%s',
    async (hostPolicy) => {
      const { plugin, permissions } = createPlugin({ accessTokenId: TOKEN_ID }, hostPolicy);
      permissions.getPermissionsByAccessToken.mockResolvedValue(['record|read', 'record|update']);
      expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
      expect(permissions.getPermissionsByAccessToken).toHaveBeenCalledWith(TARGET_ID, TOKEN_ID);
      expect(permissions.validPermissions).not.toHaveBeenCalled();
    }
  );

  it('preserves target-resource PAT rejections with a registered host user policy', async () => {
    const { plugin, permissions } = createPlugin({ accessTokenId: TOKEN_ID }, true);
    permissions.getPermissionsByAccessToken.mockRejectedValue(denial());
    expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
    expect(permissions.validPermissions).not.toHaveBeenCalled();
  });

  it('does not veto an EE matrix grant using the raw Community role', async () => {
    const { plugin, permissions } = createPlugin({ accessTokenId: TOKEN_ID }, true);
    permissions.validPermissions.mockRejectedValue(denial());
    expect((await plugin.prepare(context())).isOk()).toBe(true);
    expect(permissions.validPermissions).not.toHaveBeenCalled();
    expect(permissions.getPermissionsByAccessToken).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'checks share-view target scope with host policy=%s',
    async (hostPolicy) => {
      const { plugin, permissions } = createPlugin({ shareViewId: 'shr-view' }, hostPolicy);
      permissions.validShareViewPermissions.mockRejectedValueOnce(denial());
      expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
      expect(permissions.validShareViewPermissions).toHaveBeenCalledWith('shr-view', TARGET_ID, [
        'record|create',
      ]);
      expect((await plugin.prepare(context())).isOk()).toBe(true);
      expect(permissions.validPermissions).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'checks base-share node and linked-only scope with host policy=%s',
    async (hostPolicy) => {
      const { plugin, permissions } = createPlugin(
        { baseShareId: 'shr-base', baseShare: { baseId: BASE_ID } },
        hostPolicy
      );
      permissions.validBaseSharePermissions.mockRejectedValueOnce(denial());
      expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
      expect(permissions.validBaseSharePermissions).toHaveBeenCalledWith('shr-base', TARGET_ID, [
        'record|create',
      ]);
      expect((await plugin.prepare(context())).isOk()).toBe(true);
    }
  );

  it.each([false, true])(
    'checks robot/temp-auth against the actual target with host policy=%s',
    async (hostPolicy) => {
      const { plugin, permissions } = createPlugin(
        { 'user.id': APP_ROBOT_ID, tempAuthBaseId: BASE_ID },
        hostPolicy
      );
      permissions.validPermissions.mockRejectedValueOnce(denial());
      expect((await plugin.prepare(context(APP_ROBOT_ID)))._unsafeUnwrapErr().tags).toContain(
        'forbidden'
      );
      expect(permissions.validPermissions).toHaveBeenCalledWith(TARGET_ID, ['record|create']);
      expect((await plugin.prepare(context(APP_ROBOT_ID))).isOk()).toBe(true);
    }
  );

  it('does not let a human temp-auth marker override the installed host matrix', async () => {
    const { plugin, permissions } = createPlugin({ tempAuthBaseId: BASE_ID }, true);
    permissions.validPermissions.mockRejectedValue(denial());

    expect((await plugin.prepare(context())).isOk()).toBe(true);
    expect(permissions.validPermissions).not.toHaveBeenCalled();
  });

  it('keeps Community human callers on the native target role without a host policy', async () => {
    const { plugin, permissions } = createPlugin({ tempAuthBaseId: BASE_ID });
    permissions.validPermissions.mockRejectedValue(denial());

    expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
    expect(permissions.validPermissions).toHaveBeenCalledWith(TARGET_ID, ['record|create']);
  });

  it('does not treat a base-share cache without a share identity as a grant', async () => {
    const { plugin } = createPlugin({ baseShare: { baseId: BASE_ID } }, true);
    expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
  });

  it.each([
    { values: { 'user.id': undefined }, actorId: USER_ID },
    { values: {}, actorId: SYSTEM_USER_ID },
  ])(
    'preserves trusted internal calls without collaborator requirements',
    async ({ values, actorId }) => {
      const { plugin, permissions } = createPlugin(values);
      expect((await plugin.prepare(context(actorId))).isOk()).toBe(true);
      expect(permissions.validPermissions).not.toHaveBeenCalled();
    }
  );

  it('does not exempt anonymous callers or mismatched actor identities', async () => {
    const anonymous = createPlugin({ 'user.id': 'anonymous' });
    anonymous.permissions.validPermissions.mockRejectedValue(denial());
    expect(
      (await anonymous.plugin.prepare(context('anonymous')))._unsafeUnwrapErr().tags
    ).toContain('forbidden');
    const mismatched = createPlugin();
    expect(
      (await mismatched.plugin.prepare(context(`usr${'x'.repeat(16)}`)))._unsafeUnwrapErr().tags
    ).toContain('forbidden');
  });

  it('keeps PAT and share ceilings on internal calls', async () => {
    const token = createPlugin({ 'user.id': undefined, accessTokenId: TOKEN_ID }, true);
    token.permissions.getPermissionsByAccessToken.mockResolvedValue(['record|read']);
    expect((await token.plugin.prepare(context(SYSTEM_USER_ID)))._unsafeUnwrapErr().tags).toContain(
      'forbidden'
    );
    const share = createPlugin({ 'user.id': undefined, shareViewId: 'shr-view' }, true);
    share.permissions.validShareViewPermissions.mockRejectedValue(denial());
    expect((await share.plugin.prepare(context(SYSTEM_USER_ID)))._unsafeUnwrapErr().tags).toContain(
      'forbidden'
    );
  });

  it('retains the native template create restriction even with a host policy', async () => {
    const { plugin, permissions } = createPlugin({ template: { baseId: BASE_ID } }, true);
    permissions.validTemplatePermissions.mockRejectedValue(denial());
    expect((await plugin.prepare(context()))._unsafeUnwrapErr().tags).toContain('forbidden');
    expect(permissions.validTemplatePermissions).toHaveBeenCalledWith(TARGET_ID, ['record|create']);
  });

  it('does not disguise unexpected policy failures as permission denials', async () => {
    const { plugin, permissions } = createPlugin();
    const failure = new Error('metadata unavailable');
    permissions.validPermissions.mockRejectedValue(failure);
    await expect(plugin.prepare(context())).rejects.toBe(failure);
  });
});
