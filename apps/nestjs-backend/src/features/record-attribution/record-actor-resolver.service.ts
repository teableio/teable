import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { RecordInitiator } from '@teable/v2-core';

export type RecordActorReference = RecordInitiator;
export type RecordActorDisplay = { name: string; avatar: string | null };
export type RecordActorMap = Record<string, RecordActorDisplay | null>;
export interface IRecordActorProfileResolver {
  resolve(baseId: string, actors: ReadonlyArray<RecordActorReference>): Promise<RecordActorMap>;
}
export const RECORD_ACTOR_PROFILE_RESOLVER = Symbol('record-actor-profile-resolver');

/** Presentation only. Callers have already authorized the table/history read. */
@Injectable()
export class RecordActorResolverService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(RECORD_ACTOR_PROFILE_RESOLVER)
    private readonly profiles?: IRecordActorProfileResolver
  ) {}

  private async resolveUsers(
    baseId: string,
    users: ReadonlyArray<RecordActorReference>
  ): Promise<RecordActorMap> {
    const resolved: RecordActorMap = {};
    if (!users.length) return resolved;
    // Never look up an arbitrary global principal. The allowed display scope is
    // the same base/space collaboration scope as the authorized history read.
    const base = await this.prisma.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { spaceId: true },
    });
    if (!base) return resolved;
    const memberships = await this.prisma.collaborator.findMany({
      where: {
        principalType: 'user',
        principalId: { in: users.map((actor) => actor.id) },
        OR: [
          { resourceType: 'base', resourceId: baseId },
          { resourceType: 'space', resourceId: base.spaceId },
        ],
      },
      select: { principalId: true },
    });
    const ids = memberships.map((membership) => membership.principalId);
    if (!ids.length) return resolved;
    const records = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedTime: null },
      select: { id: true, name: true, avatar: true },
    });
    for (const user of records) {
      resolved[`user:${user.id}`] = { name: user.name, avatar: user.avatar };
    }
    return resolved;
  }

  async resolve(
    tableId: string,
    history: ReadonlyArray<{
      actorType?: RecordActorReference['type'] | null;
      actorId?: string | null;
    }>
  ): Promise<RecordActorMap> {
    const actors = new Map<string, RecordActorReference>();
    for (const row of history) {
      if (row.actorType && row.actorId) {
        actors.set(`${row.actorType}:${row.actorId}`, { type: row.actorType, id: row.actorId });
      }
    }
    const result: RecordActorMap = Object.fromEntries([...actors.keys()].map((key) => [key, null]));
    if (!actors.size) return result;
    const table = await this.prisma.tableMeta.findFirst({
      where: { id: tableId, deletedTime: null },
      select: { baseId: true },
    });
    if (!table) return result;
    const users = [...actors.values()].filter((actor) => actor.type === 'user');
    Object.assign(result, await this.resolveUsers(table.baseId, users));
    if (this.profiles) {
      const resolved = await this.profiles.resolve(
        table.baseId,
        [...actors.values()].filter((actor) => actor.type !== 'user')
      );
      for (const key of actors.keys()) {
        if (key in resolved) result[key] = resolved[key];
      }
    }
    return result;
  }
}
