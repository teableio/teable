import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { LastVisitResourceType } from '@teable/openapi';
import type { IUpdateOrderRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { CollaboratorService } from '../collaborator/collaborator.service';

interface IOrderableBase {
  id: string;
  spaceId: string;
  /** The space's shared order, the last resort of the personal arrangement. */
  order: number;
}

/**
 * A user's own arrangement of the bases they can see (`user_base_order`). Three tiers make
 * up the personal order of a space, in this sequence:
 *
 *  0. bases the user has not arranged yet but has visited — newest visit first, so before
 *     the first rearrangement the list is simply "most recently visited on top", and a base
 *     that shows up later surfaces at the top once opened (creating one records a visit, so
 *     a new base lands on top right away);
 *  1. bases with a saved position, in that order;
 *  2. bases never visited and never arranged, in the space's shared order.
 *
 * The first move in a space freezes the order the user currently sees into saved positions
 * (integers, rewritten in full on every move — a space has tens of bases, not thousands), so
 * from then on visiting no longer reshuffles anything. Nobody else's list is touched.
 */
@Injectable()
export class BasePersonalOrderService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly collaboratorService: CollaboratorService,
    private readonly permissionService: PermissionService
  ) {}

  /** Sort `bases` (already access-filtered) the way the current user arranged them. */
  async sortForUser<T extends IOrderableBase>(
    bases: T[]
  ): Promise<(T & { personalOrder?: number })[]> {
    const userId = this.cls.get('user.id');
    if (!userId || bases.length === 0) return bases;
    const baseIds = bases.map((base) => base.id);
    const [saved, visits] = await Promise.all([
      this.prismaService.userBaseOrder.findMany({
        where: { userId, baseId: { in: baseIds } },
        select: { baseId: true, order: true },
      }),
      this.prismaService.userLastVisit.findMany({
        where: { userId, resourceType: LastVisitResourceType.Base, resourceId: { in: baseIds } },
        select: { resourceId: true, lastVisitTime: true },
      }),
    ]);
    const savedOrder = new Map(saved.map((row) => [row.baseId, row.order]));
    const visitedAt = new Map(visits.map((row) => [row.resourceId, row.lastVisitTime.getTime()]));

    const rank = (base: IOrderableBase): [tier: number, key: number] => {
      const position = savedOrder.get(base.id);
      if (position !== undefined) return [1, position];
      const visited = visitedAt.get(base.id);
      if (visited !== undefined) return [0, -visited];
      return [2, base.order];
    };

    return bases
      .map((base) => ({ ...base, personalOrder: savedOrder.get(base.id) }))
      .sort((a, b) => {
        if (a.spaceId !== b.spaceId) return a.spaceId < b.spaceId ? -1 : 1;
        const [tierA, keyA] = rank(a);
        const [tierB, keyB] = rank(b);
        return tierA - tierB || keyA - keyB;
      });
  }

  /** Move `baseId` before / after `anchorId` in the caller's arrangement of that space. */
  async move(baseId: string, { anchorId, position }: IUpdateOrderRo): Promise<void> {
    const userId = this.cls.get('user.id');
    const base = await this.prismaService.base.findFirst({
      where: { id: baseId, deletedTime: null },
      select: { id: true, spaceId: true },
    });
    if (!base || !userId) {
      throw new NotFoundException('Base not found');
    }
    const siblings = await this.accessibleBasesOfSpace(base.spaceId);
    if (!siblings.some((sibling) => sibling.id === baseId)) {
      // Reachable by id but outside what the caller (or their token) may see.
      throw new NotFoundException('Base not found');
    }
    if (!siblings.some((sibling) => sibling.id === anchorId)) {
      // Also covers an anchor from another space: personal order is per space.
      throw new BadRequestException('Anchor base must be an accessible base of the same space');
    }
    if (anchorId === baseId) return;

    const current = (await this.sortForUser(siblings)).map((sibling) => sibling.id);
    const arranged = current.filter((id) => id !== baseId);
    const anchorIndex = arranged.indexOf(anchorId);
    arranged.splice(position === 'before' ? anchorIndex : anchorIndex + 1, 0, baseId);

    // Freeze the whole space as integers 1..n: the first move materializes the fallback
    // order the user was looking at, later moves just rewrite it.
    await this.prismaService.$tx(async () => {
      const tx = this.prismaService.txClient();
      await tx.userBaseOrder.deleteMany({ where: { userId, baseId: { in: arranged } } });
      await tx.userBaseOrder.createMany({
        data: arranged.map((id, index) => ({ userId, baseId: id, order: index + 1 })),
      });
    });
  }

  /** Forget the caller's arrangement of a space; the list returns to last-visit recency. */
  async reset(spaceId: string): Promise<void> {
    const userId = this.cls.get('user.id');
    if (!userId) return;
    const [{ spaceIds }, range] = await Promise.all([
      this.collaboratorService.getCurrentUserCollaboratorsBaseAndSpaceArray(),
      this.tokenRange(),
    ]);
    // A space collaborator (within the token's range, if any) forgets the whole space, trashed
    // bases included; a base-level guest or a base-scoped token only the bases they can see.
    const wholeSpace = spaceIds.includes(spaceId) && (!range || range.spaceIds.has(spaceId));
    const visible = wholeSpace ? [] : await this.accessibleBasesOfSpace(spaceId);
    if (!wholeSpace && visible.length === 0) {
      throw new NotFoundException('Space not found');
    }
    await this.prismaService.userBaseOrder.deleteMany({
      where: {
        userId,
        ...(wholeSpace
          ? { base: { spaceId } }
          : { baseId: { in: visible.map((base) => base.id) } }),
      },
    });
  }

  /** Live bases of `spaceId` the caller can see, in the space's shared order. */
  private async accessibleBasesOfSpace(spaceId: string): Promise<IOrderableBase[]> {
    const [{ spaceIds, baseIds }, range] = await Promise.all([
      this.collaboratorService.getCurrentUserCollaboratorsBaseAndSpaceArray(),
      this.tokenRange(),
    ]);
    const bases = await this.prismaService.base.findMany({
      where: {
        spaceId,
        deletedTime: null,
        ...(spaceIds.includes(spaceId) ? {} : { id: { in: baseIds } }),
      },
      select: { id: true, spaceId: true, order: true },
      orderBy: { order: 'asc' },
    });
    // A resource-scoped token sees only its range, exactly like the base list it reads.
    return range
      ? bases.filter((base) => range.baseIds.has(base.id) || range.spaceIds.has(base.spaceId))
      : bases;
  }

  /** The resource range of a scoped access token, or null when the caller is not token-bound. */
  private async tokenRange(): Promise<{ spaceIds: Set<string>; baseIds: Set<string> } | null> {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) return null;
    const token = await this.permissionService.getAccessToken(accessTokenId);
    if (token.hasFullAccess) return null;
    return { spaceIds: new Set(token.spaceIds ?? []), baseIds: new Set(token.baseIds ?? []) };
  }
}
