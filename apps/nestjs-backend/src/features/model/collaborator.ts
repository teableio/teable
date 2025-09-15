import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { PerformanceCache, PerformanceCacheService } from '../../performance-cache';
import { generateCollaboratorCacheKey } from '../../performance-cache/generate-keys';
import { dateToIso } from '../../utils/date-to-iso';

@Injectable()
export class CollaboratorModel {
  constructor(
    private readonly prismaService: PrismaService,
    protected readonly performanceCacheService: PerformanceCacheService
  ) {
    this.prismaService.$use(async (params, next) => {
      if (
        params.model === 'Collaborator' &&
        (params.action.includes('update') || params.action.includes('delete'))
      ) {
        const resourceId = params.args?.where?.resourceId;
        if (typeof resourceId === 'string') {
          await this.performanceCacheService.del(generateCollaboratorCacheKey(resourceId));
        } else if (typeof resourceId === 'object' && 'in' in resourceId) {
          const resourceIds = resourceId.in as string[];
          await Promise.all(
            resourceIds.map((id) =>
              this.performanceCacheService.del(generateCollaboratorCacheKey(id))
            )
          );
        }
      }
      if (params.model === 'Collaborator' && params.action.includes('create')) {
        const createData = params.args?.data;
        if (Array.isArray(createData)) {
          await Promise.all(
            createData.map((data) =>
              this.performanceCacheService.del(generateCollaboratorCacheKey(data.resourceId))
            )
          );
        } else {
          await this.performanceCacheService.del(
            generateCollaboratorCacheKey(createData.resourceId)
          );
        }
      }
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
