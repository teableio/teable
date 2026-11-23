import { ORPCError } from '@orpc/server';
import { mapDuplicateBaseResultToDto } from '@teable/v2-contract-http';
import type { IV2OrpcRouterOptions } from '@teable/v2-contract-http-implementation';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  BaseId,
  DeleteTableCommand,
  DuplicateBaseByIdCommand,
  v2CoreTokens,
  type DuplicateBaseByIdResult,
  type ICommandBus,
  type IExecutionContext,
} from '@teable/v2-core';

/** Explicit standalone host fixture: physical schemas and collaborator-scoped discovery. */
export const createExpressBasesHost = (
  runtime: IV2NodeTestContainer,
  context: IExecutionContext
): NonNullable<IV2OrpcRouterOptions['basesHost']> => {
  const actorId = context.actorId.toString();
  const create: NonNullable<IV2OrpcRouterOptions['basesHost']>['create'] = async (input) => {
    const membership = await runtime.metaDb
      .selectFrom('collaborator')
      .select('id')
      .where('resource_id', '=', input.spaceId)
      .where('principal_id', '=', actorId)
      .where('principal_type', '=', 'user')
      .executeTakeFirst();
    if (!membership) throw new ORPCError('FORBIDDEN');
    const id = BaseId.generate()._unsafeUnwrap().toString();
    await runtime.metaDb
      .insertInto('base')
      .values({
        id,
        name: input.name ?? null,
        icon: input.icon ?? null,
        space_id: input.spaceId,
        order: Date.now(),
        created_by: actorId,
      })
      .execute();
    try {
      await runtime.dataDb.schema.createSchema(id).ifNotExists().execute();
      await runtime.metaDb
        .insertInto('collaborator')
        .values({
          id: `col${id.slice(3)}`,
          resource_type: 'base',
          resource_id: id,
          principal_id: actorId,
          principal_type: 'user',
        })
        .execute();
    } catch (error) {
      await runtime.dataDb.schema.dropSchema(id).ifExists().cascade().execute();
      await runtime.metaDb.deleteFrom('base').where('id', '=', id).execute();
      throw error;
    }
    return {
      ok: true,
      data: {
        base: { id, name: input.name ?? null, spaceId: input.spaceId, icon: input.icon ?? null },
      },
    };
  };
  const commandBus = runtime.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  return {
    create,
    list: async ({ spaceId: requestedSpace, search, offset, limit }) => {
      const memberships = await runtime.metaDb
        .selectFrom('collaborator')
        .select(['resource_id', 'resource_type'])
        .where('principal_id', '=', actorId)
        .where('principal_type', '=', 'user')
        .execute();
      const bases = await runtime.metaDb
        .selectFrom('base')
        .selectAll()
        .where('deleted_time', 'is', null)
        .orderBy('order', 'asc')
        .execute();
      const visible = bases.filter(
        (base) =>
          memberships.some(
            (membership) =>
              membership.resource_id ===
              (membership.resource_type === 'space' ? base.space_id : base.id)
          ) &&
          (!requestedSpace || base.space_id === requestedSpace) &&
          (!search || base.name?.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      );
      return {
        ok: true,
        data: {
          bases: visible.slice(offset, offset + limit).map((base) => ({
            id: base.id,
            name: base.name,
            spaceId: base.space_id!,
            icon: base.icon ?? null,
            role: 'creator' as const,
            createdBy: base.created_by,
          })),
          hasMore: visible.length > offset + limit,
        },
      };
    },
    duplicate: async (input) => {
      const source = await runtime.metaDb
        .selectFrom('base')
        .selectAll()
        .where('id', '=', input.sourceBaseId)
        .executeTakeFirstOrThrow();
      const target = await create({
        spaceId: source.space_id!,
        name: input.name ?? `${source.name ?? ''} (Copy)`,
      });
      const targetId = target.data.base.id;
      try {
        const command = DuplicateBaseByIdCommand.create(
          { ...input, targetBaseId: targetId },
          { adoptExistingTarget: true }
        );
        if (command.isErr()) throw new Error(command.error.message);
        const result = await commandBus.execute<DuplicateBaseByIdCommand, DuplicateBaseByIdResult>(
          context,
          command.value
        );
        if (result.isErr()) throw new Error(result.error.message);
        const mapped = mapDuplicateBaseResultToDto(result.value);
        if (mapped.isErr()) throw new Error(mapped.error.message);
        return { ok: true, data: mapped.value };
      } catch (error) {
        const tables = await runtime.metaDb
          .selectFrom('table_meta')
          .select('id')
          .where('base_id', '=', targetId)
          .execute();
        for (const table of tables) {
          const command = DeleteTableCommand.create({
            tableId: table.id,
            baseId: targetId,
            mode: 'permanent',
          });
          if (command.isErr()) throw new Error(command.error.message);
          const result = await commandBus.execute(context, command.value);
          if (result.isErr()) throw new Error(result.error.message);
        }
        await runtime.dataDb.schema.dropSchema(targetId).ifExists().cascade().execute();
        await runtime.metaDb
          .deleteFrom('collaborator')
          .where('resource_id', '=', targetId)
          .execute();
        await runtime.metaDb.deleteFrom('base').where('id', '=', targetId).execute();
        throw error;
      }
    },
  };
};
