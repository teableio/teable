import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  importOptionRoSchema,
  inplaceImportOptionRoSchema,
  type IImportOptionRo,
  type IImportStatusVo,
} from '@teable/openapi';
import { importedTableDtoSchema } from '@teable/v2-contract-http';
import type { IV2WorkflowHostBindings } from '@teable/v2-contract-http-implementation';
import type { Job, Queue } from 'bullmq';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import type { IClsStore } from '../../../types/cls';
import { AggregationOpenApiV2Service } from '../../aggregation/open-api/aggregation-open-api-v2.service';
import { PermissionService } from '../../auth/permission.service';
import {
  fingerprintQueuedCredentialSign,
  runWithQueuedCredentialCeiling,
  type IQueuedCredentialCeiling,
} from '../../auth/queued-credential-ceiling';
import { ImportOpenApiV2Service } from '../../import/open-api/import-open-api-v2.service';
import { NotificationService } from '../../notification/notification.service';
import { V2PublicProcedureService } from '../v2-public-procedure.service';
import {
  V2_IMPORT_WORKFLOW_POLICY,
  type IV2ImportWorkflowPolicy,
} from './v2-import-workflow-policy';
import {
  V2_IMPORT_WORKFLOW_QUEUE,
  type IV2ImportPrincipal,
  type IV2ImportWorkflowJob,
  type IV2ImportWorkflowProgress,
} from './v2-import-workflow.types';

interface IWorkflowCacheStore extends ICacheStore {
  [key: `v2-import:latest:${string}`]: string;
}

@Injectable()
export class V2WorkflowService {
  private readonly logger = new Logger(V2WorkflowService.name);
  constructor(
    private readonly aggregation: AggregationOpenApiV2Service,
    private readonly imports: ImportOpenApiV2Service,
    private readonly procedures: V2PublicProcedureService,
    private readonly cls: ClsService<IClsStore>,
    private readonly moduleRef: ModuleRef,
    private readonly cache: CacheService<IWorkflowCacheStore>,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly permissions: PermissionService,
    @InjectQueue(V2_IMPORT_WORKFLOW_QUEUE)
    private readonly queue: Queue<IV2ImportWorkflowJob, IV2ImportWorkflowProgress>
  ) {}

  createBindings(): IV2WorkflowHostBindings {
    return {
      aggregateRecords: ({ tableId, ...query }) => this.aggregation.getAggregation(tableId, query),
      countRecords: ({ tableId, ...query }) => this.aggregation.getRowCount(tableId, query),
      importTableFromFile: ({ baseId, options }) => {
        const parsed = importOptionRoSchema.safeParse(options);
        if (!parsed.success) throw new BadRequestException(parsed.error.message);
        return this.createTables(baseId, parsed.data);
      },
      inplaceImportTableFromFile: (input) => {
        const parsed = inplaceImportOptionRoSchema.safeParse(input.options);
        if (!parsed.success) throw new BadRequestException(parsed.error.message);
        return this.enqueueImport({ ...input, options: parsed.data });
      },
      getImportStatus: ({ tableId }) => this.getImportStatus(tableId),
    };
  }

  private async withBudget<T>(
    baseId: string,
    tableId: string | undefined,
    run: (options: { maxRowCount?: number; projection?: string[] }) => Promise<T>
  ): Promise<T> {
    const invocation = this.procedures.current();
    let policy: IV2ImportWorkflowPolicy | undefined;
    try {
      policy = this.moduleRef.get<IV2ImportWorkflowPolicy>(V2_IMPORT_WORKFLOW_POLICY, {
        strict: false,
      });
    } catch {
      // Community edition has no subscription/field-policy extension.
    }
    return policy
      ? policy.around(
          { baseId, tableId, container: invocation.container, context: invocation.context },
          run
        )
      : run({});
  }

  private async createTables(baseId: string, options: IImportOptionRo) {
    const result = await this.withBudget(baseId, undefined, ({ maxRowCount }) =>
      this.imports.createTableFromImportWithSummary(baseId, options, maxRowCount)
    );
    // Enrich the native import DTO with persisted host view provenance.
    const storedViews = await this.prisma.view.findMany({
      where: { tableId: { in: result.tables.map((table) => table.id) }, deletedTime: null },
      select: { id: true, createdBy: true, createdTime: true },
    });
    const viewProvenance = new Map(storedViews.map((view) => [view.id, view]));
    for (const table of result.tables) {
      for (const view of table.views) {
        const provenance = viewProvenance.get(view.id);
        if (!provenance) throw new Error(`Imported view metadata is missing: ${view.id}`);
        view.createdBy = provenance.createdBy;
        view.createdTime = provenance.createdTime.toISOString();
      }
    }
    if (options.notification) {
      for (const table of result.tables) {
        await this.sendNotification({
          baseId,
          tableId: table.id,
          toUserId: this.cls.get('user.id'),
          message: {
            i18nKey: 'common.email.templates.notify.import.table.success.message',
            context: { tableName: table.name },
          },
        });
      }
    }
    return { ...result, tables: result.tables.map((table) => importedTableDtoSchema.parse(table)) };
  }

  private principal(): IV2ImportPrincipal {
    this.procedures.current();
    const store = this.cls.get();
    return {
      user: store.user,
      accessTokenId: store.accessTokenId,
      origin: store.origin,
      entry: store.entry,
      tempAuthBaseId: store.tempAuthBaseId,
      authSource: store.authSource,
      sandboxPrincipal: store.sandboxPrincipal,
      appId: store.appId,
      workflowContext: store.workflowContext,
    };
  }

  private async captureCredentialCeiling(
    principal: IV2ImportPrincipal
  ): Promise<IQueuedCredentialCeiling | undefined> {
    if (!principal.accessTokenId) return;
    const token = await this.prisma.accessToken.findFirst({
      where: { id: principal.accessTokenId, userId: principal.user.id },
      select: { sign: true, clientId: true, expiredTime: true },
    });
    if (!token || (token.expiredTime && token.expiredTime.getTime() <= Date.now())) {
      throw new ForbiddenException('Import credential is no longer valid');
    }
    const grants = await this.permissions.getAccessToken(principal.accessTokenId);
    return {
      accessTokenId: principal.accessTokenId,
      userId: principal.user.id,
      scopes: [...grants.scopes],
      spaceIds: grants.spaceIds ? [...grants.spaceIds] : [],
      baseIds: grants.baseIds ? [...grants.baseIds] : [],
      hasFullAccess: grants.hasFullAccess === true,
      signFingerprint: fingerprintQueuedCredentialSign(token.sign),
      expiresAt: token.expiredTime?.getTime() ?? null,
      clientId: token.clientId,
      authSource: principal.authSource,
      appId: principal.appId,
      tempAuthBaseId: principal.tempAuthBaseId,
      sandboxPrincipal: principal.sandboxPrincipal,
    };
  }

  private async enqueueImport(
    input: Omit<IV2ImportWorkflowJob, 'principal' | 'credentialCeiling'>
  ) {
    const principal = this.principal();
    const credentialCeiling = await this.captureCredentialCeiling(principal);
    const job = await this.queue.add(
      'import',
      { ...input, principal, credentialCeiling },
      {
        jobId: randomUUID(),
        attempts: 1,
      }
    );
    if (!job.id) throw new Error('Import queue did not assign a job identifier');
    await this.cache.setDetail(`v2-import:latest:${input.tableId}`, job.id, 7 * 24 * 60 * 60);
    return { tableId: input.tableId, jobId: job.id };
  }

  private publicImportStatus(state: string): IImportStatusVo['status'] {
    switch (state) {
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'active':
        return 'running';
      case 'unknown':
        return 'not_found';
      default:
        return 'pending';
    }
  }

  async getImportStatus(tableId: string): Promise<IImportStatusVo> {
    const id = await this.cache.get(`v2-import:latest:${tableId}`);
    if (!id) return { tableId, status: 'not_found' };
    let job = await this.queue.getJob(id);
    if (!job) return { tableId, status: 'not_found' };
    const state = await job.getState();
    // getState reads Redis independently of this job snapshot. Completion may
    // have populated returnvalue after getJob loaded it.
    if (state === 'completed' || state === 'failed') {
      job = await this.queue.getJob(id);
      if (!job) return { tableId, status: 'not_found' };
    }
    const progress =
      typeof job.progress === 'object' ? (job.progress as IV2ImportWorkflowProgress) : undefined;
    const counts = state === 'completed' ? job.returnvalue : progress;
    return {
      tableId,
      status: this.publicImportStatus(state),
      ...(counts && { successCount: counts.successCount, failedCount: counts.failedCount }),
      ...(state === 'failed' && { message: job.failedReason }),
    };
  }

  async executeImport(job: Job<IV2ImportWorkflowJob, IV2ImportWorkflowProgress>) {
    const { baseId, tableId, options, principal, credentialCeiling } = job.data;
    if (
      principal.accessTokenId &&
      (!credentialCeiling || credentialCeiling.accessTokenId !== principal.accessTokenId)
    ) {
      throw new ForbiddenException('Queued import credential snapshot is missing or mismatched');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: principal.user.id, deletedTime: null },
      select: { id: true, name: true, email: true, isAdmin: true },
    });
    if (!user) throw new ForbiddenException('Import initiator is no longer active');
    return this.cls.run(async () => {
      this.cls.set('user', user);
      this.cls.set('origin', principal.origin);
      this.cls.set('accessTokenId', principal.accessTokenId);
      this.cls.set('entry', principal.entry);
      this.cls.set('tempAuthBaseId', principal.tempAuthBaseId);
      this.cls.set('authSource', principal.authSource);
      this.cls.set('sandboxPrincipal', principal.sandboxPrincipal);
      this.cls.set('appId', principal.appId);
      this.cls.set('workflowContext', principal.workflowContext);
      // A worker starts a new transaction scope; live transaction clients cannot cross jobs.
      this.cls.set('tx', {});
      // invoke validates the current PAT/resource and installs its actual granted permissions
      // before constructing the execution context or running any import command.
      const invoke = () =>
        this.procedures.invoke(
          ['workflows', 'inplaceImportTableFromFile'],
          { baseId, tableId, options },
          async () => {
            let latest: IV2ImportWorkflowProgress = { successCount: 0 };
            let version = 0;
            let write: Promise<void> | undefined;
            const flush = () => {
              if (write) return;
              write = (async () => {
                let written: number;
                do {
                  written = version;
                  await job.updateProgress(latest);
                } while (written !== version);
              })().finally(() => {
                write = undefined;
              });
              void write.catch(() => undefined);
            };
            try {
              const result = await this.withBudget(baseId, tableId, ({ maxRowCount, projection }) =>
                this.imports.importRecords(
                  baseId,
                  tableId,
                  options,
                  maxRowCount,
                  projection,
                  (progress) => {
                    latest = {
                      successCount: progress.processedRows,
                      totalRows: progress.totalRows,
                    };
                    version++;
                    flush();
                  }
                )
              );
              await write;
              latest = { successCount: result.totalImported, failedCount: 0 };
              await job.updateProgress(latest);
              await this.notify(job.data, true, result.totalImported);
              return { output: { ok: true as const, data: latest }, context: {} };
            } catch (error) {
              await write?.catch(() => undefined);
              await job.updateProgress(latest).catch((progressError) => {
                this.logger.warn('Import failure progress update failed', progressError);
              });
              await this.notify(job.data, false, latest.successCount);
              throw error;
            }
          }
        );
      const outcome = credentialCeiling
        ? await runWithQueuedCredentialCeiling(credentialCeiling, invoke)
        : await invoke();
      return outcome.output.data;
    });
  }

  private async notify(data: IV2ImportWorkflowJob, success: boolean, count: number) {
    if (!data.options.notification) return;
    let table: { name: string } | null;
    try {
      table = await this.prisma.tableMeta.findFirst({
        where: { id: data.tableId, baseId: data.baseId, deletedTime: null },
        select: { name: true },
      });
    } catch (error) {
      this.logger.warn('Import result notification metadata failed', error);
      return;
    }
    if (!table) return;
    await this.sendNotification({
      baseId: data.baseId,
      tableId: data.tableId,
      toUserId: data.principal.user.id,
      message: {
        i18nKey: success
          ? count
            ? 'common.email.templates.notify.import.table.success.inplace'
            : 'common.email.templates.notify.import.table.noRecordsProcessed.message'
          : 'common.email.templates.notify.import.table.aborted.message',
        context: {
          tableName: table.name,
          errorMessage: 'Import interrupted; inspect import status',
          range: '',
        },
      },
    });
  }

  private async sendNotification(
    params: Parameters<NotificationService['sendImportResultNotify']>[0]
  ) {
    try {
      await this.notifications.sendImportResultNotify(params);
    } catch (error) {
      this.logger.warn('Import result notification failed', error);
    }
  }
}
