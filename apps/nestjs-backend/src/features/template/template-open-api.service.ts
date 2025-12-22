import { Injectable } from '@nestjs/common';
import { generateTemplateCategoryId, generateTemplateId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';

import { UploadType } from '@teable/openapi';
import type {
  ITemplateCategoryListVo,
  ICreateTemplateCategoryRo,
  ICreateTemplateRo,
  ITemplateListQueryRo,
  IUpdateTemplateCategoryRo,
  IUpdateTemplateRo,
  ITemplateQueryRoSchema,
} from '@teable/openapi';
import { isNumber } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../configs/threshold.config';
import { CustomHttpException } from '../../custom.exception';
import { PerformanceCacheService, PerformanceCache } from '../../performance-cache';
import {
  generateTemplateCacheKeyByBaseId,
  generateTemplateCategoryCacheKey,
} from '../../performance-cache/generate-keys';
import type { IClsStore } from '../../types/cls';
import { AttachmentsStorageService } from '../attachments/attachments-storage.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { BaseDuplicateService } from '../base/base-duplicate.service';

@Injectable()
export class TemplateOpenApiService {
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
    const order = await this.prismaService.template.aggregate({
      _max: {
        order: true,
      },
    });
    const finalOrder = isNumber(order._max.order) ? order._max.order + 1 : 1;

    return await this.prismaService.template.create({
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

    if (take && take > 1000) {
      throw new CustomHttpException('Take count is too large', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.template.takeCountTooLarge',
        },
      });
    }

    const res = await this.prismaService.template.findMany({
      orderBy: {
        order: 'asc',
      },
      skip,
      take,
    });

    const previewUrlMap: Record<string, string> = {};
    for (const item of res) {
      const cover = item.cover ? JSON.parse(item.cover) : undefined;
      if (!cover) {
        continue;
      }

      const { path } = cover;
      // Template cover is stored in publicBucket, no need for signed URL
      previewUrlMap[item.id] = getPublicFullStorageUrl(path);
    }

    return res.map((item) => ({
      ...item,
      categoryId: item.categoryId,
      cover: item.cover
        ? {
            ...JSON.parse(item.cover),
            presignedUrl: previewUrlMap[item.id],
          }
        : undefined,
      snapshot: item.snapshot ? JSON.parse(item.snapshot as string) : undefined,
      publishInfo: item.publishInfo ?? undefined,
    }));
  }

  async getPublishedTemplateList(templateQuery?: ITemplateQueryRoSchema) {
    const { skip = 0, take = 100 } = templateQuery ?? {};
    const featured = templateQuery?.featured;
    const categoryId = templateQuery?.categoryId;
    const search = templateQuery?.search;

    if (take && take > 1000) {
      throw new CustomHttpException('Take count is too large', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.template.takeCountTooLarge',
        },
      });
    }

    const res = await this.prismaService.template.findMany({
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

    const previewUrlMap: Record<string, string> = {};
    for (const item of res) {
      const cover = item.cover ? JSON.parse(item.cover) : undefined;
      if (!cover) {
        continue;
      }

      const { path } = cover;
      // Template cover is stored in publicBucket, no need for signed URL
      previewUrlMap[item.id] = getPublicFullStorageUrl(path);
    }

    return res.map((item) => ({
      ...item,
      categoryId: item.categoryId,
      cover: item.cover
        ? {
            ...JSON.parse(item.cover),
            presignedUrl: previewUrlMap[item.id],
          }
        : undefined,
      snapshot: item.snapshot ? JSON.parse(item.snapshot as string) : undefined,
      publishInfo: item.publishInfo ?? undefined,
    }));
  }

  async deleteTemplate(templateId: string) {
    return await this.prismaService.template
      .delete({
        where: {
          id: templateId,
        },
      })
      .then(async (res) => {
        if (res.baseId) {
          await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
        }
        return res;
      });
  }

  async updateTemplate(templateId: string, updateTemplateRo: IUpdateTemplateRo) {
    const newCover = updateTemplateRo?.cover
      ? JSON.stringify(updateTemplateRo.cover)
      : updateTemplateRo?.cover;

    const originalTemplate = await this.prismaService.template.findUniqueOrThrow({
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

    await this.prismaService.template
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
          true
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
            },
          })
          .then(async (res) => {
            if (res.baseId) {
              await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
            }
            return res;
          });
      },
      {
        timeout: this.thresholdConfig.bigTransactionTimeout,
      }
    );
  }

  async createTemplateCategory(createTemplateCategoryRo: ICreateTemplateCategoryRo) {
    const userId = this.cls.get('user.id');
    const categoryId = generateTemplateCategoryId();
    const maxOrder = await this.prismaService.templateCategory.aggregate({
      _max: {
        order: true,
      },
    });

    const finalOrder = isNumber(maxOrder._max.order) ? maxOrder._max.order + 1 : 1;

    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());

    return await this.prismaService.templateCategory.create({
      data: {
        id: categoryId,
        ...createTemplateCategoryRo,
        createdBy: userId,
        order: finalOrder,
      },
    });
  }

  async getTemplateCategoryList() {
    return await this.prismaService.templateCategory.findMany({
      orderBy: {
        order: 'asc',
      },
    });
  }

  @PerformanceCache({
    ttl: 60 * 60 * 24,
    keyGenerator: generateTemplateCategoryCacheKey,
    statsType: 'template',
  })
  async getPublishedTemplateCategoryList() {
    const publishedTemplateCategoryIdsRaw = await this.prismaService.template.findMany({
      where: {
        isPublished: true,
      },
      select: {
        categoryId: true,
      },
    });

    const publishedTemplateCategoryIds = Array.from(
      new Set(
        publishedTemplateCategoryIdsRaw.flatMap((item) => item.categoryId ?? []).filter((id) => id)
      )
    );

    if (!publishedTemplateCategoryIds.length) {
      return [] as ITemplateCategoryListVo[];
    }

    return await this.prismaService.templateCategory.findMany({
      where: {
        id: {
          in: publishedTemplateCategoryIds,
        },
      },
      orderBy: {
        order: 'asc',
      },
    });
  }

  async pinTopTemplate(templateId: string) {
    const result = await this.prismaService.template.aggregate({
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

    await this.prismaService.template
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
    await this.prismaService.templateCategory.delete({
      where: { id: categoryId },
    });
  }

  async updateTemplateCategory(
    categoryId: string,
    updateTemplateCategoryRo: IUpdateTemplateCategoryRo
  ) {
    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());
    await this.prismaService.templateCategory.update({
      where: { id: categoryId },
      data: { ...updateTemplateCategoryRo },
    });
  }

  async getTemplateDetailById(templateId: string) {
    const template = await this.prismaService.template.findUniqueOrThrow({
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

    return {
      ...template,
      categoryId: template.categoryId,
      cover: {
        ...newCover,
      },
      snapshot: template.snapshot ? JSON.parse(template.snapshot as string) : undefined,
      publishInfo: template.publishInfo ?? undefined,
    };
  }

  async getTemplateByBaseId(baseId: string) {
    const template = await this.prismaService.template.findFirst({
      where: { baseId },
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

    return {
      ...template,
      categoryId: template.categoryId,
      cover: cover ? { ...newCover } : null,
      snapshot: template.snapshot ? JSON.parse(template.snapshot as string) : null,
      publishInfo: template.publishInfo ?? null,
    };
  }

  async incrementTemplateVisitCount(templateId: string) {
    await this.prismaService.template.update({
      where: { id: templateId },
      data: { visitCount: { increment: 1 } },
    });
  }
}
