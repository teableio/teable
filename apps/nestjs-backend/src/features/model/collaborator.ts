import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { ClsService } from 'nestjs-cls';
import type { IPerformanceCacheStore } from '../../performance-cache';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateCollaboratorCacheKey } from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { dateToIso } from '../../utils/date-to-iso';
import { clearCache } from './helper';

@Injectable()
export class CollaboratorModel {
  constructor(
    private readonly prismaService: PrismaService,
    protected readonly performanceCacheService: PerformanceCacheService,
    private readonly cls: ClsService<IClsStore>
  ) {
    this.prismaService.$use(async (params, next) => {
      const clearCacheKeys: (keyof IPerformanceCacheStore)[] = [];
      if (
        params.model === 'Collaborator' &&
        (params.action.includes('update') || params.action.includes('delete'))
      ) {
        const resourceId = params.args?.where?.resourceId;
        if (typeof resourceId === 'string') {
          clearCacheKeys.push(generateCollaboratorCacheKey(resourceId));
        } else if (typeof resourceId === 'object' && 'in' in resourceId) {
          const resourceIds = resourceId.in as string[];
          clearCacheKeys.push(...resourceIds.map(generateCollaboratorCacheKey));
        }
      }

      if (params.model === 'Collaborator' && params.action.includes('create')) {
        const createData = params.args?.data;
        if (Array.isArray(createData)) {
          clearCacheKeys.push(
            ...createData.map(({ resourceId }) => generateCollaboratorCacheKey(resourceId))
          );
        } else {
          clearCacheKeys.push(generateCollaboratorCacheKey(createData.resourceId));
        }
      }
      await clearCache(params, clearCacheKeys, this.performanceCacheService, this.cls);
      return next(params);
    });
  }

  @PerformanceCache({
    ttl: 60 * 5,
    statsType: 'collaborator',
    keyGenerator: generateCollaboratorCacheKey,
  })
  async getCollaboratorRawByResourceId(resourceId: string) {
    const res = await this.prismaService.collaborator.findMany({
      where: {
        resourceId: resourceId,
      },
    });
    return res.map((item) => dateToIso(item));
  }
}
