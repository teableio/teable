import { Injectable, Logger } from '@nestjs/common';
import { generateTemplateCategoryId, generateTemplateId, HttpErrorCode } from '@teable/core';
import { Prisma, PrismaService } from '@teable/db-main-prisma';

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
  ShortLinkType,
  TemplateCategoryKind,
  TemplateListSort,
} from '@teable/openapi';
import { isEqual, isNumber, omit } from 'lodash';
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
import { AuditScope } from '../audit/audit-scope';
import { PermissionService } from '../auth/permission.service';
import { BaseDuplicateV2Service } from '../base/base-duplicate-v2.service';
import { buildBaseNodeDefaultUrl } from '../base-node/base-node-url.helper';
import { firstPublishHistory, listedTemplateWhere, templateIdOrSlugWhere } from '../model/template';
import { ShortLinkService } from '../short-link/short-link.service';
import { ensureTemplateSlug, slugFromName } from './template-slug';
import {
  lockTemplateSnapshotSwap,
  retireTemplateSnapshot,
  withStagedTemplateSnapshot,
} from './template-snapshot.helper';

// Snapshotting a template's source base (with its records) into the template space.
const TEMPLATE_SNAPSHOT_ACTION = 'template.snapshot.create';

/** Template fields an update may change, other than the publish flag (its own row). */
const TEMPLATE_UPDATE_KEYS = [
  'name',
  'description',
  'markdownDescription',
  'categoryId',
  'cover',
  'featured',
  'isSystem',
  'baseId',
  'slug',
] as const;

@Injectable()
export class TemplateOpenApiService {
  private readonly logger = new Logger(TemplateOpenApiService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly baseDuplicateV2Service: BaseDuplicateV2Service,
    private readonly cls: ClsService<IClsStore>,
    private readonly attachmentsStorageService: AttachmentsStorageService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly performanceCacheService: PerformanceCacheService,
    private readonly shortLinkService: ShortLinkService,
    private readonly audit: AuditScope,
    private readonly permissionService: PermissionService
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

    const template = await prisma.template.create({
      data: {
        id: templateId,
        ...createTemplateRo,
        createdBy: userId,
        order: finalOrder,
      },
    });
    await this.audit.emitAtomic({
      action: 'template.create',
      resourceId: templateId,
      params: {
        templateId,
        name: createTemplateRo.name,
      },
    });
    return template;
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
        version: true,
        manifest: true,
        history: true,
        parentTemplateId: true,
        slug: true,
        review: true,
      },
    });

    return this.transformTemplateListResult(res, { withEmail: true });
  }

  async getPublishedTemplateList(templateQuery?: ITemplateQueryRoSchema) {
    const { skip = 0, take = 100 } = templateQuery ?? {};
    const prisma = this.prismaService.txClient();
    const featured = templateQuery?.featured;
    const categoryId = templateQuery?.categoryId;
    const searchTerms = templateQuery?.search?.split(/\s+/).filter(Boolean) ?? [];
    const sort = templateQuery?.sort;

    this.validateTakeCount(take);

    // An industry lists what is filed under it and under any of its sub-industries.
    const categoryIds = categoryId
      ? [
          categoryId,
          ...(
            await prisma.templateCategory.findMany({
              where: { parentId: categoryId },
              select: { id: true },
            })
          ).map((c) => c.id),
        ]
      : undefined;

    const res = await prisma.template.findMany({
      where: {
        ...listedTemplateWhere(),
        AND: [
          featured === true
            ? { featured: true }
            : featured === false
              ? { OR: [{ featured: false }, { featured: null }] }
              : {},
          ...searchTerms.map((term) => ({
            OR: [
              { name: { contains: term, mode: 'insensitive' as const } },
              { description: { contains: term, mode: 'insensitive' as const } },
            ],
          })),
        ],
        categoryId: categoryIds ? { hasSome: categoryIds } : undefined,
        createdBy: templateQuery?.createdBy,
      },
      orderBy: sort === TemplateListSort.Newest ? { lastModifiedTime: 'desc' } : { order: 'asc' },
      skip,
      take,
    });

    return this.transformTemplateListResult(
      await this.withSlugs(res.map((item) => omit(item, ['review'])))
    );
  }

  /** Templates listed before slugs existed get theirs the first time anyone reads them. */
  private async withSlugs<T extends { id: string; name: string | null; slug: string | null }>(
    items: T[]
  ): Promise<T[]> {
    const prisma = this.prismaService.txClient();
    const out: T[] = [];
    for (const item of items) {
      out.push(item.slug ? item : { ...item, slug: await ensureTemplateSlug(prisma, item) });
    }
    return out;
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

  protected async transformTemplateListResult<
    T extends { id: string; cover: string | null; snapshot: string | null; createdBy: string },
  >(templates: T[], options?: { withEmail?: boolean }) {
    const previewUrlMap: Record<string, string> = {};
    const userIds = templates.map((item) => item.createdBy).filter((id) => !!id);
    const userMap = await this.getSpecifiedUserInfoByUserId(userIds, options?.withEmail);

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

  /**
   * Owner-side unpublish: instance admins, or whoever can publish the source base (base|update).
   * Templates without a source base (created from the admin panel) are admin-only.
   */
  async unpublishTemplate(templateId: string) {
    if (!this.cls.get('user.isAdmin')) {
      const template = await this.prismaService.txClient().template.findUnique({
        where: { id: templateId },
        select: { baseId: true },
      });
      if (!template?.baseId) {
        throw new CustomHttpException(
          `not allowed to unpublish template ${templateId}`,
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.permission.notAllowedOperation',
            },
          }
        );
      }
      await this.assertCanUnpublishFromBase(template.baseId);
    }
    return this.deleteTemplate(templateId);
  }

  /** Same permission as publishing the base (`POST /base/:baseId/publish`). */
  protected async assertCanUnpublishFromBase(baseId: string) {
    await this.permissionService.validPermissions(
      baseId,
      ['base|update'],
      this.cls.get('accessTokenId')
    );
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
        // The template is hard-deleted, so its short links are dead for good
        await this.shortLinkService.markDeletedByResource(ShortLinkType.Template, templateId);
        // Also the owner's "unpublish" route, which removes the template the same way.
        await this.audit.emitAtomic({
          action: 'template.delete',
          resourceId: templateId,
          params: {
            templateId,
            name: res.name,
            ...(res.baseId ? { baseId: res.baseId } : {}),
            ...(res.isPublished ? { wasPublished: true } : {}),
          },
        });
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
    if (updateTemplateRo.slug) {
      const taken = await prisma.template.findFirst({
        where: { slug: updateTemplateRo.slug, NOT: { id: templateId } },
        select: { id: true },
      });
      if (taken) {
        throw new CustomHttpException('Slug already in use', HttpErrorCode.VALIDATION_ERROR, {
          localization: { i18nKey: 'httpErrors.template.slugTaken' },
        });
      }
    }

    await prisma.template
      .update({
        where: { id: templateId },
        data: {
          ...updateTemplateRo,
          categoryId: updateTemplateRo.categoryId,
          cover: newCover as string | null | undefined,
          ...(updateTemplateRo.isPublished && !originalTemplate.history
            ? {
                history: firstPublishHistory(
                  originalTemplate.version
                ) as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      })
      .then(async (res) => {
        if (updateTemplateRo.isPublished) {
          await ensureTemplateSlug(prisma, res);
        }
        if (res.baseId) {
          await this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(res.baseId));
        }
        // Clear permalink cache when template is updated (especially when publish status changes)
        await this.performanceCacheService.del(generateTemplatePermalinkCacheKey(templateId));
        return res;
      });
    await this.auditTemplateUpdate(
      originalTemplate,
      updateTemplateRo,
      newCover as string | null | undefined
    );
  }

  /**
   * Publishing to (or withdrawing from) the public template gallery is its own row; any other field
   * the request changed is one `template.update` row listing the keys. Fields sent unchanged write
   * nothing.
   */
  private async auditTemplateUpdate(
    original: {
      id: string;
      name: string | null;
      baseId: string | null;
      isPublished: boolean | null;
    },
    ro: IUpdateTemplateRo,
    newCover: string | null | undefined
  ): Promise<void> {
    const templateId = original.id;
    const scope = {
      templateId,
      name: ro.name ?? original.name,
      ...((ro.baseId ?? original.baseId) ? { baseId: ro.baseId ?? original.baseId } : {}),
    };
    const next: Record<string, unknown> = { ...ro, cover: newCover };
    const changedKeys = TEMPLATE_UPDATE_KEYS.filter(
      (key) =>
        ro[key] !== undefined &&
        !isEqual(next[key] ?? null, (original as Record<string, unknown>)[key] ?? null)
    );
    if (changedKeys.length) {
      await this.audit.emitAtomic({
        action: 'template.update',
        resourceId: templateId,
        params: {
          ...scope,
          changedKeys,
          ...(changedKeys.includes('baseId') ? { previousBaseId: original.baseId ?? null } : {}),
        },
      });
    }
    if (ro.isPublished === undefined || ro.isPublished === Boolean(original.isPublished)) return;
    if (ro.isPublished) {
      await this.audit.emitAtomic({
        action: 'template.publish',
        resourceId: templateId,
        params: scope,
      });
      return;
    }
    await this.audit.emitAtomic({
      action: 'template.unpublish',
      resourceId: templateId,
      params: scope,
    });
  }

  /**
   * Copies the template's source base, records included, into the template space. The copy runs in
   * a `template.snapshot.create` operation, so the rows it writes for the snapshot base are
   * attributed to it; the row itself is written once the snapshot committed.
   */
  async createTemplateSnapshot(templateId: string) {
    return this.audit.withOperation(
      { rootAction: TEMPLATE_SNAPSHOT_ACTION, resourceId: templateId },
      async () => {
        const template = await this.snapshotTemplate(templateId);
        const snapshot = JSON.parse(template.snapshot ?? '{}') as { baseId?: string };
        await this.audit.emitAtomic({
          action: TEMPLATE_SNAPSHOT_ACTION,
          resourceId: templateId,
          params: {
            templateId,
            name: template.name,
            ...(template.baseId ? { baseId: template.baseId } : {}),
            snapshotBaseId: snapshot.baseId,
            withRecords: true,
          },
        });
        return template;
      }
    );
  }

  private async snapshotTemplate(templateId: string) {
    const prisma = this.prismaService.txClient();
    const templateRaw = await prisma.template.findUniqueOrThrow({
      where: { id: templateId },
      select: {
        baseId: true,
        name: true,
        snapshot: true,
        publishInfo: true,
      },
    });

    const sourceBaseId = templateRaw.baseId;
    if (!sourceBaseId) {
      throw new CustomHttpException('Source template not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.template.sourceTemplateNotFound',
        },
      });
    }

    const templateSpaceId = await prisma.space.findFirstOrThrow({
      where: {
        isTemplate: true,
        deletedTime: null,
      },
      select: {
        id: true,
      },
    });

    const {
      base: { id, spaceId, name },
      nodeIdMap,
    } = await this.baseDuplicateV2Service.duplicateBase(
      {
        fromBaseId: sourceBaseId,
        spaceId: templateSpaceId.id,
        withRecords: true,
        name: templateRaw.name || 'template snapshot',
      },
      false,
      BaseDuplicateMode.CreateTemplate
    );
    return withStagedTemplateSnapshot(
      this.prismaService,
      sourceBaseId,
      id,
      this.cls.get('user.id'),
      async () => {
        const publishInfo = templateRaw.publishInfo;
        const hasPublishInfo =
          publishInfo && typeof publishInfo === 'object' && !Array.isArray(publishInfo);
        const activeNodeId =
          hasPublishInfo && typeof publishInfo.defaultActiveNodeId === 'string'
            ? publishInfo.defaultActiveNodeId
            : undefined;
        const snapshotActiveNodeId = activeNodeId ? (nodeIdMap[activeNodeId] ?? null) : null;
        const defaultUrl = await buildBaseNodeDefaultUrl(prisma, id, snapshotActiveNodeId);
        let oldSnapshotBaseId: string | undefined;
        const result = await this.prismaService.$tx(
          async (prisma) => {
            await lockTemplateSnapshotSwap(prisma, sourceBaseId);
            // Read the current pointer at swap time, not before the native copy started.
            const current = await prisma.template.findUniqueOrThrow({
              where: { id: templateId },
              select: { snapshot: true },
            });
            if (current.snapshot) {
              const snapshot = JSON.parse(current.snapshot);
              oldSnapshotBaseId = snapshot.baseId;
              if (oldSnapshotBaseId) {
                await retireTemplateSnapshot(prisma, oldSnapshotBaseId, this.cls.get('user.id'));
              }
            }
            return await prisma.template.update({
              where: { id: templateId },
              data: {
                snapshot: JSON.stringify({
                  baseId: id,
                  snapshotTime: new Date().toISOString(),
                  spaceId,
                  name,
                }),
                ...(hasPublishInfo
                  ? { publishInfo: { ...publishInfo, snapshotActiveNodeId, defaultUrl } }
                  : {}),
                lastModifiedBy: this.cls.get('user.id'),
              },
            });
          },
          { timeout: this.thresholdConfig.bigTransactionTimeout }
        );
        return { result, oldSnapshotBaseId };
      },
      (error) => this.logger.error(`Failed to retire staged snapshot ${id}`, error)
    ).then(async ({ result, oldSnapshotBaseId }) => {
      await Promise.all([
        this.performanceCacheService.del(generateTemplatePermalinkCacheKey(templateId)),
        ...[sourceBaseId, id, ...(oldSnapshotBaseId ? [oldSnapshotBaseId] : [])].map((baseId) =>
          this.performanceCacheService.del(generateTemplateCacheKeyByBaseId(baseId))
        ),
      ]);
      return result;
    });
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

    const { name, parentId } = createTemplateCategoryRo;
    const kind = createTemplateCategoryRo.kind ?? TemplateCategoryKind.Industry;
    if (kind === TemplateCategoryKind.Team && parentId) {
      throw this.teamIsFlatError();
    }
    if (parentId) {
      await this.assertIndustryRoot(parentId);
    }
    const key = await this.newCategoryKey(createTemplateCategoryRo.key, name);

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
        name,
        parentId,
        kind,
        key,
        createdBy: userId,
        order: finalOrder,
      },
    });
  }

  /** A sub-industry goes under an industry that is itself a root. */
  private async assertIndustryRoot(parentId: string): Promise<void> {
    const parent = await this.prismaService.txClient().templateCategory.findUnique({
      where: { id: parentId },
      select: { parentId: true, kind: true },
    });
    if (!parent) {
      throw new CustomHttpException('Template category not found', HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.template.categoryNotFound' },
      });
    }
    if (parent.kind === TemplateCategoryKind.Team) {
      throw this.teamIsFlatError();
    }
    if (parent.parentId) {
      throw new CustomHttpException(
        'A sub-industry cannot have sub-industries',
        HttpErrorCode.VALIDATION_ERROR,
        { localization: { i18nKey: 'httpErrors.template.categoryDepthExceeded' } }
      );
    }
  }

  /**
   * The key an admin typed must be free. One made from the name is only a convenience, so a
   * taken one (or a name with nothing to make it from) leaves the key empty.
   */
  private async newCategoryKey(requested: string | undefined, name: string) {
    if (requested) {
      await this.assertCategoryKeyFree(requested);
      return requested;
    }
    const derived = slugFromName(name);
    return derived && !(await this.categoryKeyTaken(derived)) ? derived : null;
  }

  private teamIsFlatError() {
    return new CustomHttpException(
      'A team has neither a parent nor sub-categories',
      HttpErrorCode.VALIDATION_ERROR,
      { localization: { i18nKey: 'httpErrors.template.teamIsFlat' } }
    );
  }

  private async categoryKeyTaken(key: string, exceptId?: string): Promise<boolean> {
    const taken = await this.prismaService.txClient().templateCategory.findFirst({
      where: { key, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    return Boolean(taken);
  }

  private async assertCategoryKeyFree(key: string, exceptId?: string): Promise<void> {
    if (await this.categoryKeyTaken(key, exceptId)) {
      throw new CustomHttpException('Key already in use', HttpErrorCode.VALIDATION_ERROR, {
        localization: { i18nKey: 'httpErrors.template.categoryKeyTaken' },
      });
    }
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
    const prisma = this.prismaService.txClient();
    const children = await prisma.templateCategory.count({ where: { parentId: categoryId } });
    if (children > 0) {
      throw new CustomHttpException(
        'This industry still has sub-industries',
        HttpErrorCode.VALIDATION_ERROR,
        { localization: { i18nKey: 'httpErrors.template.categoryHasChildren' } }
      );
    }
    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());
    await prisma.templateCategory.delete({
      where: { id: categoryId },
    });
  }

  async updateTemplateCategory(
    categoryId: string,
    updateTemplateCategoryRo: IUpdateTemplateCategoryRo
  ) {
    const { name, key } = updateTemplateCategoryRo;
    if (key) await this.assertCategoryKeyFree(key, categoryId);
    await this.performanceCacheService.del(generateTemplateCategoryCacheKey());
    await this.prismaService.txClient().templateCategory.update({
      where: { id: categoryId },
      data: { name, key },
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
    // The route is public (no session is resolved on it), so only published
    // templates are visible by id; otherwise drafts and their creator would leak
    // to anyone who guesses an id. Admins manage drafts through the admin routes.
    const template = await prisma.template.findFirst({
      where: {
        ...templateIdOrSlugWhere(templateId),
        isPublished: true,
      },
    });
    if (!template) {
      throw new CustomHttpException('Template not found', HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.base.templateNotFound' },
      });
    }
    const [withSlug] = await this.withSlugs([template]);

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
      ...omit(withSlug, ['review']),
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
        version: true,
        manifest: true,
        history: true,
        parentTemplateId: true,
        slug: true,
        review: true,
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
    await this.prismaService.txClient().template.updateMany({
      where: templateIdOrSlugWhere(templateId),
      data: { visitCount: { increment: 1 } },
    });
  }

  // The email is for admin screens only; the published list and detail are public routes.
  private async getSpecifiedUserInfoByUserId(userIds: string[], withEmail = false) {
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
        email: withEmail,
      },
    });

    return users.reduce(
      (acc, user) => {
        acc[user.id] = {
          id: user.id,
          name: user.name,
          avatar: user.avatar ? getPublicFullStorageUrl(user.avatar) : undefined,
          ...(withEmail ? { email: user.email } : {}),
        };
        return acc;
      },
      {} as Record<string, { id: string; name: string; avatar: string | undefined; email?: string }>
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
