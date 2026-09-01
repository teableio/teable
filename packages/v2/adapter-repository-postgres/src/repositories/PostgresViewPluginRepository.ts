import { getPostgresTransaction } from '@teable/v2-adapter-db-postgres-shared';
import {
  domainError,
  type DomainError,
  type IExecutionContext,
  type IViewPluginRepository,
  type UpdateViewPluginStorageInput,
  type ViewPluginDefinition,
  type ViewPluginInstallation,
  type ViewPluginInstallationInfo,
  type ViewPluginInstallationSource,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';

import { v2PostgresStateTokens } from '../di/tokens';

const viewPosition = 'view';
const publishedStatus = 'published';

@injectable()
export class PostgresViewPluginRepository implements IViewPluginRepository {
  constructor(
    @inject(v2PostgresStateTokens.db)
    private readonly db: Kysely<V1TeableDatabase>
  ) {}

  async findViewPlugin(
    context: IExecutionContext,
    pluginId: string
  ): Promise<Result<ViewPluginDefinition, DomainError>> {
    const db = getPostgresTransaction<V1TeableDatabase>(context, 'meta') ?? this.db;
    try {
      const row = await db
        .selectFrom('plugin')
        .select(['id', 'name', 'logo', 'positions'])
        .where('id', '=', pluginId)
        .where((eb) =>
          eb.or([
            eb('status', '=', publishedStatus),
            eb('created_by', '=', context.actorId.toString()),
          ])
        )
        .executeTakeFirst();
      if (!row) {
        return err(domainError.notFound({ message: `Plugin not found with id: ${pluginId}` }));
      }

      const positions = JSON.parse(row.positions) as unknown;
      if (!Array.isArray(positions) || !positions.includes(viewPosition)) {
        return err(
          domainError.validation({
            message: `Plugin ${pluginId} does not support install in view`,
          })
        );
      }
      return ok({ id: row.id, name: row.name, logo: row.logo });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to resolve View plugin: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  async insertViewPluginInstallation(
    context: IExecutionContext,
    installation: ViewPluginInstallation
  ): Promise<Result<void, DomainError>> {
    const db = getPostgresTransaction<V1TeableDatabase>(context, 'meta') ?? this.db;
    try {
      await db
        .insertInto('plugin_install')
        .values({
          id: installation.id,
          plugin_id: installation.pluginId,
          base_id: installation.baseId,
          name: installation.name,
          position_id: installation.viewId,
          position: viewPosition,
          storage: installation.storage ?? null,
          created_by: context.actorId.toString(),
          last_modified_by: null,
        })
        .execute();
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to install View plugin: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  async findViewPluginInstallationByViewId(
    context: IExecutionContext,
    viewId: string
  ): Promise<Result<ViewPluginInstallationSource, DomainError>> {
    const db = getPostgresTransaction<V1TeableDatabase>(context, 'meta') ?? this.db;
    try {
      const row = await db
        .selectFrom('plugin_install')
        .select('storage')
        .where('position_id', '=', viewId)
        .where('position', '=', viewPosition)
        .executeTakeFirst();
      if (!row) {
        return err(
          domainError.notFound({
            message: `Plugin installation not found for View: ${viewId}`,
          })
        );
      }
      return ok({ storage: row.storage });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to resolve View plugin installation: ${error instanceof Error ? error.message : String(error)}`,
        })
      );
    }
  }

  async getViewPluginInstallation(
    context: IExecutionContext,
    baseId: string,
    viewId: string
  ): Promise<Result<ViewPluginInstallationInfo, DomainError>> {
    const db = getPostgresTransaction<V1TeableDatabase>(context, 'meta') ?? this.db;
    try {
      const row = await db
        .selectFrom('plugin_install')
        .innerJoin('plugin', 'plugin.id', 'plugin_install.plugin_id')
        .select([
          'plugin_install.id as id',
          'plugin_install.plugin_id as pluginId',
          'plugin_install.base_id as baseId',
          'plugin_install.position_id as viewId',
          'plugin_install.name as name',
          'plugin_install.storage as storage',
          'plugin.url as url',
        ])
        .where('plugin_install.base_id', '=', baseId)
        .where('plugin_install.position_id', '=', viewId)
        .where('plugin_install.position', '=', viewPosition)
        .executeTakeFirst();
      if (!row) {
        return err(
          domainError.notFound({
            message: `Plugin installation not found for View: ${viewId}`,
          })
        );
      }

      let storage: Readonly<Record<string, unknown>> | undefined;
      if (row.storage != null) {
        const parsed = JSON.parse(row.storage) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return err(
            domainError.infrastructure({
              message: `Invalid storage for View plugin installation: ${row.id}`,
            })
          );
        }
        storage = parsed as Readonly<Record<string, unknown>>;
      }
      return ok({
        id: row.id,
        pluginId: row.pluginId,
        baseId: row.baseId,
        viewId: row.viewId,
        name: row.name,
        ...(row.url != null ? { url: row.url } : {}),
        ...(storage !== undefined ? { storage } : {}),
      });
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to resolve View plugin installation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      );
    }
  }

  async updateViewPluginStorage(
    context: IExecutionContext,
    input: UpdateViewPluginStorageInput
  ): Promise<Result<void, DomainError>> {
    const db = getPostgresTransaction<V1TeableDatabase>(context, 'meta') ?? this.db;
    try {
      if (input.storage === undefined) {
        const installation = await db
          .selectFrom('plugin_install')
          .select('id')
          .where('id', '=', input.pluginInstallId)
          .where('base_id', '=', input.baseId)
          .where('position_id', '=', input.viewId)
          .where('position', '=', viewPosition)
          .executeTakeFirst();
        if (!installation) {
          return err(
            domainError.notFound({
              message: `Plugin installation not found: ${input.pluginInstallId}`,
            })
          );
        }
        return ok(undefined);
      }

      const updated = await db
        .updateTable('plugin_install')
        .set({
          storage: JSON.stringify(input.storage),
          last_modified_time: new Date(),
          last_modified_by: context.actorId.toString(),
        })
        .where('id', '=', input.pluginInstallId)
        .where('base_id', '=', input.baseId)
        .where('position_id', '=', input.viewId)
        .where('position', '=', viewPosition)
        .returning('id')
        .executeTakeFirst();
      if (!updated) {
        return err(
          domainError.notFound({
            message: `Plugin installation not found: ${input.pluginInstallId}`,
          })
        );
      }
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: `Failed to update View plugin storage: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      );
    }
  }
}
