import { Injectable, Logger } from '@nestjs/common';
import { generateTemplateCategoryId, generateTemplateId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';

import {
  type ICreateTemplateCategoryRo,
  type ICreateTemplateRo,
  type ITemplateListQueryRo,
  type IUpdateTemplateCategoryRo,
  type IUpdateTemplateRo,
  type ITemplateQueryRoSchema,
  type IUpdateOrderRo,
  BaseDuplicateMode,
  MAX_TEMPLATE_CATEGORY_COUNT,
} from '@teable/openapi';
import { isNumber } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCacheService, PerformanceCache } from '../../performance-cache';
import {
  generateTemplateCacheKeyByBaseId,
  generateTemplateCategoryCacheKey,
  generateTemplatePermalinkCacheKey,
} from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { updateOrder } from '../../utils/update-order';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { BaseDuplicateService } from '../base/base-duplicate.service';

@Injectable()
export class TemplateOpenApiService {
  private logger = new Logger(TemplateOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseDuplicateService: BaseDuplicateService,
    private readonly cls: ClsService<IClsStore>,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly performanceCacheService: PerformanceCacheService
  ) {}

  async createTemplate(createTemplateRo: ICreateTemplateRo) {
    const userId = this.cls.get('user.id');
    const templateId = generateTemplateId();
    const prisma = this.prismaService.txClient();
    const order = await prisma.template.aggregate({
      _max: {
        order: true,
      },
    });
    const finalOrder = isNumber(order._max.order) ? order._max.order + 1 : 1;

    return await prisma.template.create({
      data: {
        id: templateId,
        ...createTemplateRo,
        createdBy: userId,
        order: finalOrder,
      },
    });
  }

  async getAllTemplateList(query?: ITemplateListQueryRo) {
    const { skip = 0, take = 300 } = query ?? {};
    const prisma = this.prismaService.txClient();

    this.validateTakeCount(take);

    const res = await prisma.template.findMany({
      orderBy: {
        order: 'asc',
      },
      skip,
      take,
      select: {
        id: true,
        name: true,
        cover: true,
        snapshot: true,
        createdBy: true,
        categoryId: true,
        isSystem: true,
        featured: true,
        isPublished: true,
        description: true,
        baseId: true,
        usageCount: true,
        markdownDescription: true,
        publishInfo: true,
        visitCount: true,
      },
    });

    return this.transformTemplateListResult(res);
  }

  async getPublishedTemplateList(templateQuery?: ITemplateQueryRoSchema) {
    const { skip = 0, take = 100 } = templateQuery ?? {};
    const prisma = this.prismaService.txClient();
    const featured = templateQuery?.featured;
    const categoryId = templateQuery?.categoryId;
    const search = templateQuery?.search;

    this.validateTakeCount(take);

    const res = await prisma.template.findMany({
      where: {
        isPublished: true,
        ...(featured === true
          ? { featured: true }
          : featured === false
            ? { OR: [{ featured: false }, { featured: null }] }
            : {}),
        categoryId: categoryId ? { has: categoryId } : undefined,
        name: search ? { contains: search, mode: 'insensitive' } : undefined,
      },
      orderBy: {
        order: 'asc',
      },
      skip,
      take,
    });

    return this.transformTemplateListResult(res);
  }

  private validateTakeCount(take: number) {
    if (take && take > 1000) {
      throw new CustomHttpException('Take count is too large', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.template.takeCountTooLarge',
        },
      });
    }
  }

  private async transformTemplateListResult<
    T extends { id: string; cover: string | null; snapshot: string | null; createdBy: string },
  >(templates: T[]) {
    const previewUrlMap: Record<string, string> = {};
    const userIds = templates.map((item) => item.createdBy).filter((id) => !!id);
    const userMap = await this.getSpecifiedUserInfoByUserId(userIds);

    for (const item of templates) {
      const cover = item.cover ? JSON.parse(item.cover) : undefined;
      if (!cover) {
        continue;
      }

      const { path, thumbnailPath } = cover;
      // Use thumbnail path if the image is larger than thumbnail size
      const finalThumbnailPath = thumbnailPath?.lg ?? path;
      // Template cover is stored in publicBucket, no need for signed URL
      previewUrlMap[item.id] = getPublicFullStorageUrl(finalThumbnailPath);
    }

    return templates.map((item) => {
      const creator = userMap?.[item.createdBy];
      return {
        ...item,
        cover: item.cover
          ? {
              ...JSON.parse(item.cover),
              presignedUrl: previewUrlMap[item.id],
            }
          : undefined,
        snapshot: item.snapshot ? JSON.parse(item.snapshot) : undefined,
        createdBy: creator ?? null,
      };
    });
  }

  async deleteTemplate(templateId: string) {
    return await this.prismaService
      .txClient()
      .template.delete({
        where: {
          id: templateId,
        },
      })
      .then(async (res) => {
        if (res.baseId) {
          await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
        }
        // Clear permalink cache
        await this.performanceCacheService.del(generateTemplatePermalinkCacheKey(templateId));
        return res;
      });
  }

  async updateTemplate(templateId: string, updateTemplateRo: IUpdateTemplateRo) {
    const prisma = this.prismaService.txClient();
    const newCover = updateTemplateRo?.cover
      ? JSON.stringify(updateTemplateRo.cover)
      : updateTemplateRo?.cover;

    const originalTemplate = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
    });

    if (updateTemplateRo.isPublished && !originalTemplate.snapshot) {
      throw new CustomHttpException(
        'This template could not be published, causing the lacking of snapshot',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.template.snapshotRequired',
          },
        }
      );
    }

    await prisma.template
      .update({
        where: { id: templateId },
        data: {
          ...updateTemplateRo,
          categoryId: updateTemplateRo.categoryId,
          cover: newCover as string | null | undefined,
        },
      })
      .then(async (res) => {
        if (res.baseId) {
          await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
        }
        // Clear permalink cache when template is updated (especially when publish status changes)
        await this.performanceCacheService.del(generateTemplatePermalinkCacheKey(templateId));
        return res;
      });
  }

  async createTemplateSnapshot(templateId: string) {
    const prisma = this.prismaService.txClient();
    const templateRaw = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
      select: {
        baseId: true,
        name: true,
        snapshot: true,
      },
    });

    if (!templateRaw.baseId) {
      throw new CustomHttpException('Source template not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.template.sourceTemplateNotFound',
        },
      });
    }

    const templateSpaceId = await prisma.space.findFirstOrThrow({
      where: {
        isTemplate: true,
      },
      select: {
        id: true,
      },
    });

    return await this.prismaService.$tx(
      async (prisma) => {
        // duplicate a base for template snapshot, not allow cross base field relative, all cross base link field will be duplicated as single text fields
        const {
          base: { id, spaceId, name },
        } = await this.baseDuplicateService.duplicateBase(
          {
            fromBaseId: templateRaw.baseId!,
            spaceId: templateSpaceId.id,
            withRecords: true,
            name: templateRaw?.name || 'template snapshot',
          },
          false,
          BaseDuplicateMode.CreateTemplate
        );

        if (templateRaw.snapshot) {
          // delete previous base
          const snapshot = JSON.parse(templateRaw.snapshot);
          await prisma.base.update({
            where: { id: snapshot.baseId },
            data: {
              deletedTime: new Date().toISOString(),
            },
          });
        }

        return await prisma.template
          .update({
            where: { id: templateId },
            data: {
              snapshot: JSON.stringify({
                baseId: id,
                snapshotTime: new Date().toISOString(),
                spaceId,
                name,
              }),
              lastModifiedBy: this.cls.get('user.id'),
            },
          })
          .then(async (res) => {
            if (res.baseId) {
              await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
            }
            // Clear permalink cache when snapshot is updated
            await this.performanceCacheService.del(generateTemplatePermalinkCacheKey(templateId));
            return res;
          });
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async createTemplateCategory(createTemplateCategoryRo: ICreateTemplateCategoryRo) {
    const prisma = this.prismaService.txClient();
    const userId = this.cls.get('user.id');

    // Check if category limit reached (max 50)
    const categoryCount = await prisma.templateCategory.count();
    if (categoryCount >= MAX_TEMPLATE_CATEGORY_COUNT) {
      throw new CustomHttpException(
        `Template category limit reached (max ${MAX_TEMPLATE_CATEGORY_COUNT})`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.template.categoryLimitReached',
            context: {
              maxCount: MAX_TEMPLATE_CATEGORY_COUNT,
            },
          },
        }
      );
    }

    const categoryId = generateTemplateCategoryId();
    const maxOrder = await prisma.templateCategory.aggregate({
      _max: {
        order: true,
      },
    });

    const finalOrder = isNumber(maxOrder._max.order) ? maxOrder._max.order + 1 : 1;

    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());

    return await prisma.templateCategory.create({
      data: {
        id: categoryId,
        ...createTemplateCategoryRo,
        createdBy: userId,
        order: finalOrder,
      },
    });
  }

  @PerformanceCache({
    ttl: 60 * 60 * 24,
    keyGenerator: generateTemplateCategoryCacheKey,
    statsType: 'template',
  })
  async getTemplateCategoryList() {
    return await this.prismaService.txClient().templateCategory.findMany({
      orderBy: {
        order: 'asc',
      },
      // limit 50
      take: MAX_TEMPLATE_CATEGORY_COUNT,
    });
  }

  async pinTopTemplate(templateId: string) {
    const prisma = this.prismaService.txClient();
    const result = await prisma.template.aggregate({
      _min: {
        order: true,
      },
    });

    if (!isNumber(result._min.order)) {
      throw new CustomHttpException('No min order found', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.template.noMinOrderFound',
        },
      });
    }

    await prisma.template
      .update({
        where: { id: templateId },
        data: { order: result._min.order - 1 },
      })
      .then(async (res) => {
        if (res.baseId) {
          await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
        }
        return res;
      });
  }

  async deleteTemplateCategory(categoryId: string) {
    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());
    await this.prismaService.txClient().templateCategory.delete({
      where: { id: categoryId },
    });
  }

  async updateTemplateCategory(
    categoryId: string,
    updateTemplateCategoryRo: IUpdateTemplateCategoryRo
  ) {
    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());
    await this.prismaService.txClient().templateCategory.update({
      where: { id: categoryId },
      data: { ...updateTemplateCategoryRo },
    });
  }

  async shuffleCategories() {
    const categories = await this.prismaService.txClient().templateCategory.findMany({
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    this.logger.log(`category shuffle!`, 'shuffleCategories');

    await this.prismaService.$tx(async (prisma) => {
      for (let i = 0; i < categories.length; i++) {
        const category = categories[i];
        await prisma.templateCategory.update({
          where: { id: category.id },
          data: { order: i + 1 },
        });
      }
    });
  }

  async updateTemplateCategoryOrder(categoryId: string, orderRo: IUpdateOrderRo) {
    const { anchorId, position } = orderRo;
    const prisma = this.prismaService.txClient();

    // Check if there are duplicate orders, if so, shuffle first
    const categoriesOrder = await prisma.templateCategory.findMany({
      select: {
        order: true,
      },
    });

    const uniqOrder = [...new Set(categoriesOrder.map((c) => c.order))];

    // if the category order has the same order, should shuffle
    const shouldShuffle = uniqOrder.length !== categoriesOrder.length;

    if (shouldShuffle) {
      await this.shuffleCategories();
    }

    const category = await prisma.templateCategory
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { id: categoryId },
      })
      .catch(() => {
        throw new CustomHttpException('Template category not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.template.categoryNotFound',
          },
        });
      });

    const anchorCategory = await prisma.templateCategory
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { id: anchorId },
      })
      .catch(() => {
        throw new CustomHttpException(
          'Anchor template category not found',
          HttpErrorCode.NOT_FOUND,
          {
            localization: {
              i18nKey: 'httpErrors.table.anchorNotFound',
              context: {
                anchorId,
              },
            },
          }
        );
      });

    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());

    await updateOrder({
      query: null,
      position,
      item: category,
      anchorItem: anchorCategory,
      getNextItem: async (whereOrder, align) => {
        return prisma.templateCategory.findFirst({
          select: { order: true, id: true },
          where: {
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (_, id, data) => {
        await prisma.templateCategory.update({
          data: { order: data.newOrder },
          where: { id },
        });
      },
      shuffle: this.shuffleCategories.bind(this),
    });
  }

  async getTemplateDetailById(templateId: string) {
    const prisma = this.prismaService.txClient();
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
    });

    const cover = template.cover ? JSON.parse(template.cover) : undefined;

    const newCover = {
      ...cover,
      presignedUrl: undefined,
    };

    if (cover) {
      const { path } = cover;
      // Template cover is stored in publicBucket, no need for signed URL
      newCover.presignedUrl = getPublicFullStorageUrl(path);
    }

    const userMap = await this.getSpecifiedUserInfoByUserId([template.createdBy]);
    const creator = userMap?.[template.createdBy];

    return {
      ...template,
      cover: {
        ...newCover,
      },
      snapshot: template.snapshot ? JSON.parse(template.snapshot) : undefined,
      createdBy: creator,
    };
  }

  async getTemplateByBaseId(baseId: string) {
    const prisma = this.prismaService.txClient();
    const template = await prisma.template.findUnique({
      where: { baseId },
      select: {
        id: true,
        name: true,
        categoryId: true,
        isSystem: true,
        featured: true,
        isPublished: true,
        description: true,
        baseId: true,
        cover: true,
        usageCount: true,
        markdownDescription: true,
        publishInfo: true,
        visitCount: true,
        createdBy: true,
        snapshot: true,
      },
    });

    if (!template) {
      return null;
    }

    const cover = template.cover ? JSON.parse(template.cover) : undefined;

    const newCover = {
      ...cover,
      presignedUrl: undefined,
    };

    if (cover) {
      const { path } = cover;
      // Template cover is stored in publicBucket, no need for signed URL
      newCover.presignedUrl = getPublicFullStorageUrl(path);
    }

    const userMap = await this.getSpecifiedUserInfoByUserId([template.createdBy]);

    const creator = userMap?.[template.createdBy];

    return {
      ...template,
      cover: cover ? { ...newCover } : null,
      snapshot: template.snapshot ? JSON.parse(template.snapshot) : null,
      createdBy: creator ?? null,
    };
  }

  async incrementTemplateVisitCount(templateId: string) {
    await this.prismaService.txClient().template.update({
      where: { id: templateId },
      data: { visitCount: { increment: 1 } },
    });
  }

  private async getSpecifiedUserInfoByUserId(userIds: string[]) {
    const prisma = this.prismaService.txClient();
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
        deletedTime: null,
      },
      select: {
        id: true,
        name: true,
        avatar: true,
        email: true,
      },
    });

    return users.reduce(
      (acc, user) => {
        acc[user.id] = {
          id: user.id,
          name: user.name,
          avatar: user.avatar ? getPublicFullStorageUrl(user.avatar) : undefined,
          email: user.email,
        };
        return acc;
      },
      {} as Record<string, { id: string; name: string; avatar: string | undefined; email: string }>
    );
  }

  async shuffle(_query: unknown) {
    const templates = await this.prismaService.txClient().template.findMany({
      select: { id: true },
      orderBy: { order: 'asc' },
    });

    this.logger.log(`lucky template shuffle!`, 'shuffle');

    await this.prismaService.$tx(async (prisma) => {
      for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        await prisma.template.update({
          where: { id: template.id },
          data: { order: i + 1 },
        });
      }
    });
  }

  async updateOrder(templateId: string, orderRo: IUpdateOrderRo) {
    const { anchorId, position } = orderRo;
    const prisma = this.prismaService.txClient();

    // Check if there are duplicate orders, if so, shuffle first
    const templatesOrder = await prisma.template.findMany({
      select: {
        order: true,
      },
    });

    const uniqOrder = [...new Set(templatesOrder.map((t) => t.order))];

    // if the template order has the same order, should shuffle
    const shouldShuffle = uniqOrder.length !== templatesOrder.length;

    if (shouldShuffle) {
      await this.shuffle(null);
    }

    const template = await prisma.template
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { id: templateId },
      })
      .catch(() => {
        throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.base.templateNotFound',
          },
        });
      });

    const anchorTemplate = await prisma.template
      .findFirstOrThrow({
        select: { order: true, id: true },
        where: { id: anchorId },
      })
      .catch(() => {
        throw new CustomHttpException('Anchor template not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.table.anchorNotFound',
            context: {
              anchorId,
            },
          },
        });
      });

    await updateOrder({
      query: null,
      position,
      item: template,
      anchorItem: anchorTemplate,
      getNextItem: async (whereOrder, align) => {
        return prisma.template.findFirst({
          select: { order: true, id: true },
          where: {
            order: whereOrder,
          },
          orderBy: { order: align },
        });
      },
      update: async (_, id, data) => {
        await prisma.template.update({
          data: { order: data.newOrder },
          where: { id },
        });
      },
      shuffle: this.shuffle.bind(this),
    });
  }
}
