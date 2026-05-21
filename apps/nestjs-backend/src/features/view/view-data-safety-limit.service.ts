import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HttpErrorCode,
  type IFilter,
  type IGroup,
  type ISort,
  type IViewOptions,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  ensureTableDataSafetyViewOperationLimits,
  resolveTableDataSafetyLimits,
  type ResolvedTableDataSafetyLimitConfig,
  type TableDataSafetyLimitConfig,
  ViewOperationKind,
  type ViewOperationPayloadViewConfig,
  type ViewOperationPluginContext,
} from '@teable/v2-core';
import { CustomHttpException } from '../../custom.exception';

type SerializedViewProperties = {
  name?: string | null;
  description?: string | null;
  filter?: string | null;
  sort?: string | null;
  group?: string | null;
  options?: string | null;
};

type ViewPayload = ViewOperationPayloadViewConfig & {
  name?: string | null;
  description?: string | null;
  filter?: IFilter;
  sort?: ISort;
  group?: IGroup;
  options?: IViewOptions;
};

const TABLE_LIMIT_ENV_KEYS = {
  tableSchema: {
    maxViewsPerTable: 'TABLE_LIMIT_VIEWS_PER_TABLE_MAX',
  },
  viewConfig: {
    maxFilterItems: 'TABLE_LIMIT_VIEW_FILTER_ITEMS_MAX',
    maxFilterDepth: 'TABLE_LIMIT_VIEW_FILTER_DEPTH_MAX',
    maxSortItems: 'TABLE_LIMIT_VIEW_SORT_ITEMS_MAX',
    maxGroupItems: 'TABLE_LIMIT_VIEW_GROUP_ITEMS_MAX',
    maxOptionsBytes: 'TABLE_LIMIT_VIEW_OPTIONS_MAX_BYTES',
  },
  displayText: {
    maxNameLength: 'TABLE_LIMIT_NAME_MAX_LENGTH',
    maxDescriptionLength: 'TABLE_LIMIT_DESCRIPTION_MAX_LENGTH',
  },
} as const;

const parseJsonProperty = <T>(value: string | null | undefined): T | undefined => {
  if (value == null) return undefined;
  return JSON.parse(value) as T;
};

@Injectable()
export class ViewDataSafetyLimitService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService
  ) {}

  private getPositiveInteger(key: string): number | undefined {
    const value = this.configService.get<unknown>(key);
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private getLimits(): ResolvedTableDataSafetyLimitConfig {
    const config: TableDataSafetyLimitConfig = {
      tableSchema: {
        maxViewsPerTable: this.getPositiveInteger(
          TABLE_LIMIT_ENV_KEYS.tableSchema.maxViewsPerTable
        ),
      },
      viewConfig: {
        maxFilterItems: this.getPositiveInteger(TABLE_LIMIT_ENV_KEYS.viewConfig.maxFilterItems),
        maxFilterDepth: this.getPositiveInteger(TABLE_LIMIT_ENV_KEYS.viewConfig.maxFilterDepth),
        maxSortItems: this.getPositiveInteger(TABLE_LIMIT_ENV_KEYS.viewConfig.maxSortItems),
        maxGroupItems: this.getPositiveInteger(TABLE_LIMIT_ENV_KEYS.viewConfig.maxGroupItems),
        maxOptionsBytes: this.getPositiveInteger(TABLE_LIMIT_ENV_KEYS.viewConfig.maxOptionsBytes),
      },
      displayText: {
        maxNameLength: this.getPositiveInteger(TABLE_LIMIT_ENV_KEYS.displayText.maxNameLength),
        maxDescriptionLength: this.getPositiveInteger(
          TABLE_LIMIT_ENV_KEYS.displayText.maxDescriptionLength
        ),
      },
    };

    return resolveTableDataSafetyLimits(config);
  }

  private ensureViewOperation(context: ViewOperationPluginContext): void {
    const result = ensureTableDataSafetyViewOperationLimits(context, this.getLimits());
    if (result.isOk()) return;

    const error = result.error;
    throw new CustomHttpException(error.message, HttpErrorCode.VALIDATION_ERROR, {
      domainCode: error.code,
      domainTags: error.tags,
      details: error.details,
    });
  }

  async ensureCanCreateView(tableId: string): Promise<void> {
    const currentViewCount = await this.prismaService.txClient().view.count({
      where: { tableId, deletedTime: null },
    });

    this.ensureViewOperation({
      kind: ViewOperationKind.create,
      executionContext: {} as ViewOperationPluginContext['executionContext'],
      payload: {
        tableId,
        currentViewCount,
        view: {},
      },
      isTransactionBound: false,
    });
  }

  ensureViewPayload(payload: ViewPayload): void {
    this.ensureViewOperation({
      kind: ViewOperationKind.update,
      executionContext: {} as ViewOperationPluginContext['executionContext'],
      payload: {
        tableId: '',
        viewId: '',
        patch: payload,
      },
      isTransactionBound: false,
    });
  }

  ensureName(name: string | null | undefined): void {
    this.ensureViewPayload({ name });
  }

  ensureDescription(description: string | null | undefined): void {
    this.ensureViewPayload({ description });
  }

  ensureFilter(filter: IFilter | undefined): void {
    this.ensureViewPayload({ filter });
  }

  ensureSort(sort: ISort | undefined): void {
    this.ensureViewPayload({ sort });
  }

  ensureGroup(group: IGroup | undefined): void {
    this.ensureViewPayload({ group });
  }

  ensureOptions(options: IViewOptions | undefined): void {
    this.ensureViewPayload({ options });
  }

  ensureSerializedProperties(properties: SerializedViewProperties | undefined): void {
    if (!properties) return;
    this.ensureViewPayload({
      name: properties.name,
      description: properties.description,
      filter: parseJsonProperty<IFilter>(properties.filter),
      sort: parseJsonProperty<ISort>(properties.sort),
      group: parseJsonProperty<IGroup>(properties.group),
      options: parseJsonProperty<IViewOptions>(properties.options),
    });
  }
}
