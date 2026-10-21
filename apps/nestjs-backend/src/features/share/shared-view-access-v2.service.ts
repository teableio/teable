import { Injectable } from '@nestjs/common';
import { ANONYMOUS_USER_ID, HttpErrorCode } from '@teable/core';
import type { ILinkFieldOptions } from '@teable/core';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { ActorId, FieldId, FieldType, TableByIdSpec, TableId, v2CoreTokens } from '@teable/v2-core';
import type { IExecutionContext, ITableRepository, LinkField, LookupField } from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import type { Kysely } from 'kysely';
import { CustomHttpException } from '../../custom.exception';
import { V2ContainerService } from '../v2/v2-container.service';
import { ViewOpenApiV2Service } from '../view/open-api/view-open-api-v2.service';
import type { IShareViewInfo } from './share-auth.service';

const publicShareActorId = ActorId.create(ANONYMOUS_USER_ID)._unsafeUnwrap();

export type ILinkShareTarget = {
  hostTableId: string;
  tableId: string;
  linkOptions: Pick<ILinkFieldOptions, 'filterByViewId' | 'visibleFieldIds' | 'filter'>;
};

const publicShareContext = (): IExecutionContext => ({
  actorId: publicShareActorId,
});

/**
 * Resolves the public share credential through a read-model index, then loads
 * the View child through the Table aggregate query path.
 *
 * This is intentionally not a View repository: the Kysely lookup returns only
 * aggregate identity, while View state comes from `ITableRepository`.
 */
@Injectable()
export class SharedViewAccessV2Service {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly viewOpenApiV2Service: ViewOpenApiV2Service
  ) {}

  async findByShareId(shareId: string): Promise<IShareViewInfo | undefined> {
    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
    const identity = await db
      .selectFrom('view')
      .select(['id', 'table_id'])
      .where('share_id', '=', shareId)
      .where('enable_share', '=', true)
      .where('deleted_time', 'is', null)
      .executeTakeFirst();
    if (!identity) return undefined;

    const view = await this.viewOpenApiV2Service.getView(identity.table_id, identity.id, {
      actorId: publicShareActorId,
    });
    if (view.enableShare !== true || view.shareId !== shareId) return undefined;

    return {
      shareId,
      tableId: identity.table_id,
      view,
      shareMeta: view.shareMeta,
    };
  }

  /**
   * Link-field shareIds (`fld...`) identify a Field child. Kysely returns only
   * the Table identity; Field state comes from loading that Table aggregate.
   */
  async findLinkShareTarget(fieldId: string): Promise<ILinkShareTarget> {
    const container = await this.v2ContainerService.getContainer();
    const db = container.resolve<Kysely<V1TeableDatabase>>(v2MetaDbTokens.db);
    const tableRepository = container.resolve<ITableRepository>(v2CoreTokens.tableRepository);
    return this.resolveLinkShareTarget(db, tableRepository, fieldId, new Set<string>());
  }

  private async resolveLinkShareTarget(
    db: Kysely<V1TeableDatabase>,
    tableRepository: ITableRepository,
    fieldId: string,
    visited: Set<string>
  ): Promise<ILinkShareTarget> {
    if (visited.has(fieldId)) {
      throw new CustomHttpException(
        `Link field ${fieldId} is missing foreignTableId`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
          },
        }
      );
    }
    visited.add(fieldId);

    const identity = await db
      .selectFrom('field')
      .select('table_id')
      .where('id', '=', fieldId)
      .where('deleted_time', 'is', null)
      .executeTakeFirst();
    if (!identity) {
      throw new CustomHttpException(`Link field ${fieldId} not exist`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
        },
      });
    }

    const tableIdResult = TableId.create(identity.table_id);
    const fieldIdResult = FieldId.create(fieldId);
    if (tableIdResult.isErr() || fieldIdResult.isErr()) {
      throw new CustomHttpException(`Link field ${fieldId} not exist`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
        },
      });
    }

    const tableResult = await tableRepository.findOne(
      publicShareContext(),
      TableByIdSpec.create(tableIdResult.value)
    );
    if (tableResult.isErr()) {
      throw new CustomHttpException(`Link field ${fieldId} not exist`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
        },
      });
    }

    const table = tableResult.value;
    const fieldResult = table.getField((candidate) => candidate.id().equals(fieldIdResult.value));
    if (fieldResult.isErr()) {
      throw new CustomHttpException(`Link field ${fieldId} not exist`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.shareAuth.linkFieldNotFound',
        },
      });
    }

    const field = fieldResult.value;
    if (field.type().equals(FieldType.link())) {
      const linkField = field as LinkField;
      const visibleFieldIds = linkField.visibleFieldIds();
      return {
        hostTableId: table.id().toString(),
        tableId: linkField.foreignTableId().toString(),
        linkOptions: {
          filterByViewId: linkField.filterByViewId()?.toString(),
          visibleFieldIds:
            visibleFieldIds == null ? visibleFieldIds : visibleFieldIds.map((id) => id.toString()),
          filter: (linkField.config().filter() ?? undefined) as
            | ILinkFieldOptions['filter']
            | undefined,
        },
      };
    }

    if (field.type().equals(FieldType.lookup())) {
      const lookupField = field as LookupField;
      const inner = await this.resolveLinkShareTarget(
        db,
        tableRepository,
        lookupField.lookupFieldId().toString(),
        visited
      );
      return {
        hostTableId: table.id().toString(),
        tableId: inner.tableId,
        linkOptions: inner.linkOptions,
      };
    }

    throw new CustomHttpException('Field is not a link field', HttpErrorCode.RESTRICTED_RESOURCE, {
      localization: {
        i18nKey: 'httpErrors.share.fieldTypeNotLinkField',
      },
    });
  }
}
