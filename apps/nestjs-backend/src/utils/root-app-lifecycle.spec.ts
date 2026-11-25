/* eslint-disable @typescript-eslint/naming-convention */
import 'reflect-metadata';

import { existsSync } from 'node:fs';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { WorkerHost } from '@nestjs/bullmq';
import type { OnModuleDestroy } from '@nestjs/common';
import { Controller, Global, Injectable, Module, Post } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { DiscoveryModule, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Worker } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { Logger } from 'nestjs-pino';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Import production roots and bootstrap functions while substituting feature-module boundaries.
// The actual root constructors/hooks and bootstrap's Nest options are exercised below.
const communitySource = new URL('../', import.meta.url);
const enterpriseSource = new URL('../../../../../enterprise/backend-ee/src/', import.meta.url);
// The open-source tree has no enterprise backend: cover the CE root alone there.
const hasEnterpriseSource = existsSync(fileURLToPath(new URL('./app.module.ts', enterpriseSource)));
@Module({})
class BoundaryModule {
  static register() {
    return { module: BoundaryModule };
  }
  static forRoot() {
    return { module: BoundaryModule };
  }
}

const communityBoundaries = [
  ['./configs/config.module', 'ConfigModule'],
  ['./features/access-token/access-token.module', 'AccessTokenModule'],
  ['./features/aggregation/open-api/aggregation-open-api.module', 'AggregationOpenApiModule'],
  ['./features/ai/ai.module', 'AiModule'],
  ['./features/airtable-import/airtable-import.module', 'AirtableImportModule'],
  ['./features/attachments/attachments.module', 'AttachmentsModule'],
  ['./features/auth/auth.module', 'AuthModule'],
  ['./features/base/base.module', 'BaseModule'],
  ['./features/base/export-cleanup/export-base-cleanup.module', 'ExportBaseCleanupModule'],
  ['./features/base-node/base-node.module', 'BaseNodeModule'],
  ['./features/base-share/base-share.module', 'BaseShareModule'],
  ['./features/builtin-assets-init', 'BuiltinAssetsInitModule'],
  ['./features/canary', 'CanaryModule'],
  ['./features/coalesce/coalesce-consumer.module', 'CoalesceConsumerModule'],
  ['./features/collaborator/collaborator.module', 'CollaboratorModule'],
  ['./features/comment/comment-open-api.module', 'CommentOpenApiModule'],
  ['./features/dashboard/dashboard.module', 'DashboardModule'],
  ['./features/export/open-api/export-open-api.module', 'ExportOpenApiModule'],
  ['./features/field/open-api/field-open-api.module', 'FieldOpenApiModule'],
  ['./features/google-sheet-import/google-sheet-import.module', 'GoogleSheetImportModule'],
  ['./features/health/health.module', 'HealthModule'],
  ['./features/import/open-api/import-open-api.module', 'ImportOpenApiModule'],
  ['./features/integrity/integrity.module', 'IntegrityModule'],
  ['./features/invitation/invitation.module', 'InvitationModule'],
  ['./features/mail-sender/open-api/mail-sender-open-api.module', 'MailSenderOpenApiModule'],
  ['./features/mail-sender/open-api/mail-sender.merge.module', 'MailSenderMergeModule'],
  ['./features/next/next.module', 'NextModule'],
  ['./features/notification/cleanup/notification-cleanup.module', 'NotificationCleanupModule'],
  ['./features/notification/notification.module', 'NotificationModule'],
  ['./features/oauth/oauth.module', 'OAuthModule'],
  ['./features/organization/organization.module', 'OrganizationModule'],
  ['./features/pin/pin.module', 'PinModule'],
  ['./features/plugin/official/chart/plugin-chart.module', 'PluginChartModule'],
  ['./features/plugin/plugin.module', 'PluginModule'],
  ['./features/plugin-context-menu/plugin-context-menu.module', 'PluginContextMenuModule'],
  ['./features/plugin-panel/plugin-panel.module', 'PluginPanelModule'],
  ['./features/record-history-cold/record-history-cold.module', 'RecordHistoryColdModule'],
  ['./features/record-removal-cold/record-removal-cold.module', 'RecordRemovalColdModule'],
  ['./features/selection/selection.module', 'SelectionModule'],
  ['./features/setting/open-api/admin-open-api.module', 'AdminOpenApiModule'],
  ['./features/setting/open-api/setting-open-api.module', 'SettingOpenApiModule'],
  ['./features/share/share.module', 'ShareModule'],
  ['./features/short-link/short-link.module', 'ShortLinkModule'],
  ['./features/space/space.module', 'SpaceModule'],
  ['./features/template/template-open-api.module', 'TemplateOpenApiModule'],
  ['./features/trash/trash.module', 'TrashModule'],
  ['./features/undo-redo/open-api/undo-redo.module', 'UndoRedoModule'],
  ['./features/user/user.module', 'UserModule'],
  [
    './features/v2/computed-outbox-trigger/computed-outbox-wakeup-consumer.module',
    'ComputedOutboxWakeupConsumerModule',
  ],
  [
    './features/v2/domain-event-outbox-trigger/domain-event-wakeup-consumer.module',
    'DomainEventWakeupConsumerModule',
  ],
  ['./features/v2/v2-data-query.module', 'V2DataQueryModule'],
  ['./features/v2/v2-data-query-explain.module', 'V2DataQueryExplainModule'],
  ['./features/v2/v2-public.module', 'V2PublicModule'],
  ['./features/v2/v2.module', 'V2Module'],
  ['./global/global.module', 'GlobalModule'],
  ['./global/init-bootstrap.provider', 'InitBootstrapProvider'],
  ['./logger/logger.module', 'LoggerModule'],
  ['./observability/observability.module', 'ObservabilityModule'],
  ['./ws/ws.module', 'WsModule'],
] as const;
for (const [path, name] of communityBoundaries) {
  vi.doMock(new URL(path, communitySource).pathname, () => ({ [name]: BoundaryModule }));
}

const enterpriseBoundaries = [
  [
    './features/admin/access-token-legacy-cipher/access-token-legacy-cipher.module',
    'AccessTokenLegacyCipherModule',
  ],
  ['./features/admin/admin.module', 'AdminModule'],
  ['./features/admin/announcement/announcement.module', 'AnnouncementModule'],
  [
    './features/admin/app-custom-domain-backfill/app-custom-domain-backfill.module',
    'AppCustomDomainBackfillModule',
  ],
  ['./features/admin/cipher-reencrypt/cipher-reencrypt.module', 'CipherReencryptModule'],
  ['./features/admin/integrity/admin-integrity.module', 'AdminIntegrityModule'],
  ['./features/admin/jwt-credentials/jwt-credentials.module', 'JwtCredentialsModule'],
  ['./features/admin/server-secrets/server-secrets.module', 'ServerSecretsModule'],
  ['./features/admin/space/space.module', 'SpaceForAdminModule'],
  [
    './features/admin/system-field-backfill/system-field-backfill.module',
    'SystemFieldBackfillModule',
  ],
  ['./features/admin/user/deactivation/user-deactivation.module', 'UserDeactivationModule'],
  ['./features/admin/v2-rollout/v2-rollout.module', 'V2RolloutModule'],
  ['./features/ai-advanced/ai-advanced.module', 'AiAdvancedModule'],
  ['./features/ai-advanced/media-task/media-task.module', 'MediaTaskModule'],
  ['./features/ai-agent/devtools/ai-agent-devtools.module', 'AiAgentDevtoolsModule'],
  ['./features/ai-proxy/ai-proxy.module', 'AiProxyModule'],
  ['./features/analytics/posthog.module', 'PostHogModule'],
  ['./features/app/app-query-explain.module', 'AppQueryExplainModule'],
  ['./features/app/app.module', 'AppModule'],
  ['./features/archive/archive.module', 'ArchiveModule'],
  ['./features/artifact/artifact.module', 'ArtifactModule'],
  ['./features/assets-init', 'EeAssetsInitModule'],
  ['./features/audit-log/audit-log-query.module', 'AuditLogQueryModule'],
  ['./features/audit-log/audit-log.module', 'AuditLogModule'],
  ['./features/audit-log-cold/audit-log-cold.module', 'AuditLogColdModule'],
  ['./features/authority-matrix/authority-matrix.module', 'AuthorityMatrixModule'],
  ['./features/authority-matrix/undo-redo-authority.module', 'UndoRedoAuthorityModule'],
  ['./features/automation/automation.module', 'AutomationModule'],
  ['./features/billing/billing.module', 'BillingModule'],
  ['./features/chat/chat.module', 'ChatModule'],
  ['./features/chat-unread-reminder/chat-unread-reminder.module', 'ChatUnreadReminderModule'],
  ['./features/credential/credential.module', 'CredentialModule'],
  ['./features/enterprise/enterprise.module', 'EnterpriseModule'],
  ['./features/entitlement-expiry/entitlement-expiry.module', 'EntitlementExpiryModule'],
  ['./features/env-variable/env-variable.module', 'EnvVariableModule'],
  ['./features/github/github.module', 'GithubModule'],
  ['./features/mcp/mcp.module', 'McpModule'],
  ['./features/model/model.module', 'ModelModule'],
  ['./features/observability/observability.module', 'ObservabilityModule'],
  ['./features/organization/open-api/organization-open-api.module', 'OrganizationOpenApiModule'],
  ['./features/override/override.module', 'OverrideModule'],
  ['./features/push/push.module', 'PushModule'],
  ['./features/reward/reward.module', 'RewardModule'],
  ['./features/routine/routine.module', 'RoutineModule'],
  ['./features/sandbox/tool/sandbox-tool.module', 'SandboxToolModule'],
  ['./features/scrape/scrape.module', 'ScrapeModule'],
  ['./features/space-advanced/space-advanced.module', 'SpaceAdvancedModule'],
  ['./features/space-home/space-home.module', 'SpaceHomeModule'],
  ['./features/task/task.module', 'TaskModule'],
  ['./features/template/share/template-share.module', 'TemplateShareModule'],
  ['./features/trash/cleanup/trash-cleanup.module', 'TrashCleanupModule'],
  ['./features/unsubscribe/open-api/unsubscribe-open-api.module', 'UnsubscribeOpenApiModule'],
  ['./features/usage/usage.module', 'UsageModule'],
  ['./features/user-data-export/user-data-export.module', 'UserDataExportModule'],
  ['./features/user-integration/airtable-import-token.module', 'AirtableImportTokenModule'],
  ['./features/user-integration/google-sheet-import-token.module', 'GoogleSheetImportTokenModule'],
  ['./features/user-integration/integration.module', 'UserIntegrationModule'],
  ['./features/user-integration/mcp/mcp-server.module', 'McpServerModule'],
  ['./features/user-onboarding/user-onboarding.module', 'UserOnboardingModule'],
  ['./features/user-session/user-session.module', 'UserSessionModule'],
  ['./features/user-status/session-revoked.module', 'SessionRevokedModule'],
  ['./features/visit-log/visit-log.module', 'VisitLogModule'],
  ['./features/workflow-run-cold/workflow-run-cold.module', 'WorkflowRunColdModule'],
] as const;
for (const [path, name] of enterpriseBoundaries) {
  vi.doMock(new URL(path, enterpriseSource).pathname, () => ({ [name]: BoundaryModule }));
}

vi.doMock('@sentry/nestjs/setup', () => ({ SentryModule: BoundaryModule }));
vi.doMock(new URL('./utils', enterpriseSource).pathname, () => ({
  checkIsCloudEdition: () => false,
}));
vi.doMock(new URL('./configs/secrets/secrets-policy', communitySource).pathname, () => ({
  isSecretAdminToolsEnabled: () => false,
}));
vi.doMock(new URL('./features/v2/v2-container.service', communitySource).pathname, () => ({
  V2ContainerService: class {},
}));
vi.doMock(
  new URL(
    './features/v2/computed-outbox-trigger/computed-reliability-reconciliation.service',
    communitySource
  ).pathname,
  () => ({
    ComputedReliabilityReconciliationService: class {},
  })
);
vi.doMock(new URL('./filter/global-exception.filter', communitySource).pathname, () => ({
  GlobalExceptionFilter: class {},
}));
vi.doMock(new URL('./swagger', communitySource).pathname, () => ({ setupSwagger: vi.fn() }));
vi.doMock(new URL('./swagger', enterpriseSource).pathname, () => ({ setupSwagger: vi.fn() }));
vi.doMock('is-port-reachable', () => ({ default: async () => false }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function post(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = request(url, { method: 'POST', agent: false }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode!));
      response.on('error', reject);
    });
    client.on('error', reject);
    client.end();
  });
}

async function loadFixtureModules() {
  // These imports must follow the doMock calls: this fixture intentionally substitutes the
  // production module-loading boundaries before evaluating the real root decorators.
  const { AppModule: CommunityRoot } = await import(new URL('./app.module', communitySource).href);
  const EnterpriseRoot = hasEnterpriseSource
    ? (await import(new URL('./app.module', enterpriseSource).href)).AppModule
    : undefined;
  const { V2ContainerService } = await import(
    new URL('./features/v2/v2-container.service', communitySource).href
  );
  const { ComputedReliabilityReconciliationService } = await import(
    new URL(
      './features/v2/computed-outbox-trigger/computed-reliability-reconciliation.service',
      communitySource
    ).href
  );
  const community = await import(new URL('./bootstrap', communitySource).href);
  const ee = hasEnterpriseSource
    ? await import(new URL('./bootstrap', enterpriseSource).href)
    : undefined;
  return {
    CommunityRoot,
    EnterpriseRoot,
    V2ContainerService,
    ComputedReliabilityReconciliationService,
    community,
    ee,
  };
}

async function startFixture(
  enterprise: boolean,
  modules: Awaited<ReturnType<typeof loadFixtureModules>>
) {
  const {
    CommunityRoot,
    EnterpriseRoot,
    V2ContainerService,
    ComputedReliabilityReconciliationService,
  } = modules;
  const production = enterprise ? modules.ee : modules.community;
  const root = enterprise ? EnterpriseRoot : CommunityRoot;
  if (!production || !root) throw new Error('Requested production fixture is unavailable');
  const requestStarted = deferred();
  const releaseRequest = deferred();
  const projectionStarted = deferred();
  const releaseProjection = deferred();
  const releaseWorker = deferred();
  const releaseReconciliation = deferred();
  const drainStarted = deferred();
  const producersFinished = deferred();
  const closeStarted = deferred();
  const releaseHttpClose = deferred();
  const order: string[] = [];
  let requests = 0;
  let pendingProjection = Promise.resolve();
  const container = {
    drainEvents: vi.fn(async (producers: ReadonlyArray<Promise<void>> = []) => {
      drainStarted.resolve();
      await Promise.all(producers);
      producersFinished.resolve();
      await pendingProjection;
      order.push('drain');
      return true;
    }),
  };
  const reconciliation = { stop: vi.fn(() => releaseReconciliation.promise) };
  const worker = {
    run: vi.fn(async () => undefined),
    emit: vi.fn(),
    pause: vi.fn(() => releaseWorker.promise),
    close: vi.fn(async () => undefined),
  };
  const importedDestroyed = vi.fn(() => order.push('imported'));
  const cacheDestroyed = vi.fn(() => order.push('cache'));
  const communityHook = vi.spyOn(CommunityRoot.prototype, 'onModuleDestroy');
  const enterpriseHook = EnterpriseRoot
    ? vi.spyOn(EnterpriseRoot.prototype, 'onModuleDestroy')
    : vi.fn();
  @Injectable()
  class LocalWorker extends WorkerHost {
    constructor() {
      super();
      Reflect.set(this, '_worker', worker satisfies Partial<Worker>);
    }
    async process() {}
  }
  @Injectable()
  class ImportedDependency implements OnModuleDestroy {
    onModuleDestroy() {
      importedDestroyed();
    }
  }
  @Injectable()
  class CacheDependency implements OnModuleDestroy {
    onModuleDestroy() {
      cacheDestroyed();
    }
  }
  @Global()
  @Module({ providers: [CacheDependency] })
  class CacheModule {}
  @Module({ imports: [CacheModule], providers: [ImportedDependency, LocalWorker] })
  class DependenciesModule {}
  @Controller('work')
  class WorkController {
    @Post()
    async work() {
      // If closing admission is removed, the second request returns 201 and fails the assertion.
      if (++requests > 1) return { unexpectedAdmission: true };
      requestStarted.resolve();
      await releaseRequest.promise;
      pendingProjection = pendingProjection.then(async () => {
        projectionStarted.resolve();
        await releaseProjection.promise;
        order.push('projection');
      });
      return { accepted: true };
    }
  }
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  };
  const config = {
    get: (key: string) =>
      key === 'apiDoc' ? { disabled: true } : key === 'PORT' ? '0' : undefined,
  };
  // Replace only module dependencies. Keep the production root class, constructor and hook intact.
  Reflect.defineMetadata(
    MODULE_METADATA.IMPORTS,
    [DiscoveryModule, DependenciesModule],
    CommunityRoot
  );
  Reflect.defineMetadata(MODULE_METADATA.CONTROLLERS, [WorkController], CommunityRoot);
  Reflect.defineMetadata(
    MODULE_METADATA.PROVIDERS,
    [
      { provide: V2ContainerService, useValue: container },
      { provide: ComputedReliabilityReconciliationService, useValue: reconciliation },
      { provide: ConfigService, useValue: config },
      { provide: ClsService, useValue: {} },
      { provide: Logger, useValue: logger },
    ],
    CommunityRoot
  );
  if (EnterpriseRoot) {
    Reflect.defineMetadata(MODULE_METADATA.IMPORTS, [CommunityRoot], EnterpriseRoot);
    Reflect.defineMetadata(MODULE_METADATA.CONTROLLERS, [], EnterpriseRoot);
    Reflect.defineMetadata(MODULE_METADATA.PROVIDERS, [], EnterpriseRoot);
  }
  const module = await Test.createTestingModule({
    imports: [root],
  }).compile();
  const create = vi
    .spyOn(NestFactory, 'create')
    .mockImplementation(async (_root, optionsOrAdapter, options) => {
      const actualOptions = options ?? optionsOrAdapter;
      if (actualOptions && 'initHttpServer' in actualOptions) {
        throw new Error('Production bootstrap unexpectedly supplied an HTTP adapter');
      }
      return module.createNestApplication<NestExpressApplication>(actualOptions);
    });
  const priorPort = process.env.PORT;
  const priorServerPort = process.env.SERVER_PORT;
  process.env.SERVER_PORT = '0';
  const priorUnhandled = process.listeners('unhandledRejection');
  const priorUncaught = process.listeners('uncaughtException');
  let app: NestExpressApplication;
  try {
    app = (await production.bootstrap()) as NestExpressApplication;
  } finally {
    create.mockRestore();
    if (priorPort === undefined) delete process.env.PORT;
    else process.env.PORT = priorPort;
    if (priorServerPort === undefined) delete process.env.SERVER_PORT;
    else process.env.SERVER_PORT = priorServerPort;
    for (const listener of process.listeners('unhandledRejection')) {
      if (!priorUnhandled.includes(listener))
        process.removeListener('unhandledRejection', listener);
    }
    for (const listener of process.listeners('uncaughtException')) {
      if (!priorUncaught.includes(listener)) process.removeListener('uncaughtException', listener);
    }
  }
  const server: Server = app.getHttpServer();
  const originalClose = server.close.bind(server);
  const close = vi.spyOn(server, 'close').mockImplementation((callback) => {
    closeStarted.resolve();
    void releaseHttpClose.promise.then(() => originalClose(callback));
    return server;
  });
  return {
    app,
    url: (await app.getUrl()) + '/work',
    requestStarted,
    releaseRequest,
    projectionStarted,
    releaseProjection,
    releaseWorker,
    releaseReconciliation,
    drainStarted,
    producersFinished,
    closeStarted,
    releaseHttpClose,
    container,
    reconciliation,
    worker,
    importedDestroyed,
    cacheDestroyed,
    communityHook,
    enterpriseHook,
    close,
    order,
  };
}

describe('production CE and EE bootstrap/root shutdown lifecycle', () => {
  let modules: Awaited<ReturnType<typeof loadFixtureModules>>;
  beforeAll(async () => {
    modules = await loadFixtureModules();
  }, 30_000);

  it.each(hasEnterpriseSource ? [false, true] : [false])(
    'rejects new HTTP work and drains accepted work before dependencies close (EE: %s)',
    async (enterprise) => {
      const fixture = await startFixture(enterprise, modules);
      const accepted = post(fixture.url);
      let closing: Promise<void> | undefined;
      try {
        await fixture.requestStarted.promise;
        closing = fixture.app.close();
        await fixture.drainStarted.promise;
        await fixture.closeStarted.promise;
        // Keep the real socket listening until this probe: only bootstrap's actual Nest option can
        // produce 503 here. A refusal/reset from server.close is deliberately not accepted.
        expect(await post(fixture.url)).toBe(503);
        expect(fixture.importedDestroyed).not.toHaveBeenCalled();
        expect(fixture.cacheDestroyed).not.toHaveBeenCalled();
        expect(fixture.worker.pause).toHaveBeenCalledExactlyOnceWith();
        expect(fixture.reconciliation.stop).toHaveBeenCalledOnce();
        fixture.releaseHttpClose.resolve();
        fixture.releaseRequest.resolve();
        expect(await accepted).toBe(201);
        await fixture.projectionStarted.promise;
        expect(fixture.importedDestroyed).not.toHaveBeenCalled();
        expect(fixture.cacheDestroyed).not.toHaveBeenCalled();
        fixture.releaseWorker.resolve();
        fixture.releaseReconciliation.resolve();
        await fixture.producersFinished.promise;
        expect(fixture.importedDestroyed).not.toHaveBeenCalled();
        expect(fixture.cacheDestroyed).not.toHaveBeenCalled();
        fixture.releaseProjection.resolve();
        await closing;
        expect(fixture.order).toEqual(['projection', 'drain', 'imported', 'cache']);
        expect(fixture.container.drainEvents).toHaveBeenCalledOnce();
        expect(fixture.communityHook).toHaveBeenCalledOnce();
        expect(fixture.enterpriseHook).toHaveBeenCalledTimes(enterprise ? 1 : 0);
        expect(fixture.worker.pause).toHaveBeenCalledOnce();
        expect(fixture.worker.close).not.toHaveBeenCalled();
        expect(fixture.reconciliation.stop).toHaveBeenCalledOnce();
        expect(fixture.close).toHaveBeenCalledTimes(2);
      } finally {
        fixture.releaseHttpClose.resolve();
        fixture.releaseRequest.resolve();
        fixture.releaseWorker.resolve();
        fixture.releaseReconciliation.resolve();
        fixture.releaseProjection.resolve();
        await accepted.catch(() => undefined);
        await (closing ?? fixture.app.close());
        fixture.communityHook.mockRestore();
        fixture.enterpriseHook.mockRestore();
        fixture.close.mockRestore();
      }
    }
  );
});
