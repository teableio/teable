/* eslint-disable sonarjs/no-identical-functions */
import { Injectable } from '@nestjs/common';
import type {
  IAttachmentCellValue,
  IAttachmentItem,
  IButtonFieldCellValue,
  IButtonFieldOptions,
  IMakeOptional,
} from '@teable/core';
import { FieldKeyType, FieldType, HttpErrorCode, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  CreateRecordAction,
  ICreateRecordsRo,
  IUpdateRecordsRo,
  UpdateRecordAction,
} from '@teable/openapi';
import type {
  IRecordHistoryItemVo,
  ICreateRecordsVo,
  IFormSubmitRo,
  IGetRecordHistoryQuery,
  IRecord,
  IRecordHistoryVo,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
} from '@teable/openapi';
import { isEmpty, keyBy, pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import type { IClsStore } from '../../../types/cls';
import { retryOnDeadlock } from '../../../utils/retry-decorator';
import { AttachmentsService } from '../../attachments/attachments.service';
import { getPublicFullStorageUrl } from '../../attachments/plugins/utils';
import { FieldService } from '../../field/field.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { TableDomainQueryService } from '../../table-domain';
import { RecordModifyService } from '../record-modify/record-modify.service';
import { RecordModifySharedService } from '../record-modify/record-modify.shared.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import type { IUpdateRecordsInternalRo } from '../type';

@Injectable()
export class RecordOpenApiService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly recordService: RecordService,
    private readonly attachmentsService: AttachmentsService,
    private readonly recordModifyService: RecordModifyService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig,
    private readonly recordModifySharedService: RecordModifySharedService,
    private readonly tableDomainQueryService: TableDomainQueryService,
    private readonly fieldService: FieldService,
    private readonly cls: ClsService<IClsStore>,
    private readonly eventEmitterService: EventEmitterService
  ) {}

  @retryOnDeadlock()
  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false,
    isAiInternal?: string
  ): Promise<ICreateRecordsVo> {
    const res = await this.prismaService.$tx(
      async () =>
        this.recordModifyService.multipleCreateRecords(
          tableId,
          createRecordsRo,
          ignoreMissingFields
        ),
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );

    const appId = this.cls.get('appId');
    if (appId) {
      this.cls.set('skipRecordAuditLog', true);
      await this.recordService.emitRecordAuditLogEvent(
        CreateRecordAction.AppRecordCreate,
        tableId,
        createRecordsRo.records?.length ?? 0,
        appId
      );
    } else if (isAiInternal) {
      this.cls.set('skipRecordAuditLog', true);
      this.cls.set('user.id', 'aiRobot');
      await this.recordService.emitRecordAuditLogEvent(
        CreateRecordAction.AiRecordCreate,
        tableId,
        createRecordsRo.records?.length ?? 0
      );
    }

    return res;
  }

  /**
   * create records without any ops, only typecast and sql
   * @param tableId
   * @param createRecordsRo
   */
  async createRecordsOnlySql(tableId: string, createRecordsRo: ICreateRecordsRo): Promise<void> {
    await this.prismaService.$tx(async () => {
      return await this.recordModifyService.createRecordsOnlySql(tableId, createRecordsRo);
    });
  }

  async createRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo & { records: IMakeOptional<IRecordInnerRo, 'id'>[] },
    ignoreMissingFields: boolean = false
  ): Promise<ICreateRecordsVo> {
    return await this.prismaService.$tx(
      async () =>
        this.recordModifyService.multipleCreateRecords(
          tableId,
          createRecordsRo,
          ignoreMissingFields
        ),
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  @retryOnDeadlock()
  async updateRecords(
    tableId: string,
    updateRecordsRo: IUpdateRecordsRo,
    windowId?: string,
    isAiInternal?: string
  ) {
    const res = await this.recordModifyService.updateRecords(
      tableId,
      updateRecordsRo as IUpdateRecordsInternalRo,
      windowId
    );

    const appId = this.cls.get('appId');
    if (appId) {
      this.cls.set('skipRecordAuditLog', true);
      await this.recordService.emitRecordAuditLogEvent(
        UpdateRecordAction.AppRecordUpdate,
        tableId,
        updateRecordsRo.records?.length ?? 0,
        appId
      );
    } else if (isAiInternal) {
      this.cls.set('skipRecordAuditLog', true);
      this.cls.set('user.id', 'aiRobot');
      await this.recordService.emitRecordAuditLogEvent(
        UpdateRecordAction.AiRecordUpdate,
        tableId,
        updateRecordsRo.records?.length ?? 0
      );
    }

    return res;
  }

  async simpleUpdateRecords(tableId: string, updateRecordsRo: IUpdateRecordsRo) {
    return await this.recordModifyService.simpleUpdateRecords(
      tableId,
      updateRecordsRo as IUpdateRecordsInternalRo
    );
  }

  async updateRecord(
    tableId: string,
    recordId: string,
    updateRecordRo: IUpdateRecordRo,
    windowId?: string,
    isAiInternal?: string
  ): Promise<IRecord> {
    await this.updateRecords(
      tableId,
      {
        ...updateRecordRo,
        records: [{ id: recordId, fields: updateRecordRo.record.fields }],
      },
      windowId,
      isAiInternal
    );

    const snapshots = await this.recordService.getSnapshotBulkWithPermission(
      tableId,
      [recordId],
      undefined,
      updateRecordRo.fieldKeyType || FieldKeyType.Name,
      undefined,
      true
    );

    if (snapshots.length !== 1) {
      throw new CustomHttpException('update record failed', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.record.updateFailed',
        },
      });
    }

    return snapshots[0].data;
  }

  async deleteRecord(tableId: string, recordId: string, windowId?: string) {
    return this.recordModifyService.deleteRecord(tableId, recordId, windowId);
  }

  async deleteRecords(tableId: string, recordIds: string[], windowId?: string) {
    return this.recordModifyService.deleteRecords(tableId, recordIds, windowId);
  }

  async getRecordHistory(
    tableId: string,
    recordId: string | undefined,
    query: IGetRecordHistoryQuery,
    projectionIds?: string[]
  ): Promise<IRecordHistoryVo> {
    const { cursor, startDate, endDate } = query;
    const limit = 20;

    const dateFilter: { [key: string]: Date } = {};
    if (startDate) {
      dateFilter['gte'] = new Date(startDate);
    }
    if (endDate) {
      dateFilter['lte'] = new Date(endDate);
    }

    const list = await this.prismaService.recordHistory.findMany({
      where: {
        tableId,
        ...(recordId ? { recordId } : {}),
        ...(Object.keys(dateFilter).length > 0 ? { createdTime: dateFilter } : {}),
        ...(projectionIds?.length ? { fieldId: { in: projectionIds } } : {}),
      },
      select: {
        id: true,
        recordId: true,
        fieldId: true,
        before: true,
        after: true,
        createdTime: true,
        createdBy: true,
      },
      take: limit + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: {
        createdTime: 'desc',
      },
    });

    let nextCursor: typeof cursor | undefined = undefined;

    if (list.length > limit) {
      const nextItem = list.pop();
      nextCursor = nextItem?.id;
    }

    const createdBySet: Set<string> = new Set();
    const historyList: IRecordHistoryItemVo[] = [];

    for (const item of list) {
      const { id, recordId, fieldId, before, after, createdTime, createdBy } = item;

      createdBySet.add(createdBy);
      const beforeObj = JSON.parse(before as string);
      const afterObj = JSON.parse(after as string);
      const { meta: beforeMeta, data: beforeData } = beforeObj as IRecordHistoryItemVo['before'];
      const { meta: afterMeta, data: afterData } = afterObj as IRecordHistoryItemVo['after'];
      const { type: beforeType } = beforeMeta;
      const { type: afterType } = afterMeta;

      if (beforeType === FieldType.Attachment) {
        beforeObj.data = await this.recordService.getAttachmentPresignedCellValue(
          beforeData as IAttachmentCellValue
        );
      }

      if (afterType === FieldType.Attachment) {
        afterObj.data = await this.recordService.getAttachmentPresignedCellValue(
          afterData as IAttachmentCellValue
        );
      }

      historyList.push({
        id,
        tableId,
        recordId,
        fieldId,
        before: beforeObj,
        after: afterObj,
        createdTime: createdTime.toISOString(),
        createdBy,
      });
    }

    const userList = await this.prismaService.user.findMany({
      where: {
        id: {
          in: Array.from(createdBySet),
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
      },
    });

    const handledUserList = userList.map((user) => {
      const { avatar } = user;
      return {
        ...user,
        avatar: avatar && getPublicFullStorageUrl(avatar),
      };
    });

    return {
      historyList,
      userMap: keyBy(handledUserList, 'id'),
      nextCursor,
    };
  }

  private async getValidateAttachmentRecord(tableId: string, recordId: string, fieldId: string) {
    const field = await this.prismaService
      .txClient()
      .field.findFirstOrThrow({
        where: {
          id: fieldId,
          deletedTime: null,
        },
        select: {
          id: true,
          type: true,
          isComputed: true,
        },
      })
      .catch(() => {
        throw new CustomHttpException(`Field ${fieldId} not found`, HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.field.notFound',
          },
        });
      });

    if (field.type !== FieldType.Attachment) {
      throw new CustomHttpException('Field is not an attachment', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.field.notAttachment',
        },
      });
    }

    if (field.isComputed) {
      throw new CustomHttpException('Field is computed', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.field.isComputed',
        },
      });
    }

    const recordData = await this.recordService.getRecordsById(tableId, [recordId]);
    const record = recordData.records[0];
    if (!record) {
      throw new CustomHttpException(`Record ${recordId} not found`, HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.record.notFound',
        },
      });
    }
    return record;
  }

  async uploadAttachment(
    tableId: string,
    recordId: string,
    fieldId: string,
    file?: Express.Multer.File,
    fileUrl?: string
  ) {
    if (!file && !fileUrl) {
      throw new CustomHttpException('No file or URL provided', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.record.noFileOrUrlProvided',
        },
      });
    }

    const record = await this.getValidateAttachmentRecord(tableId, recordId, fieldId);

    const attachmentItem = file
      ? await this.attachmentsService.uploadFile(file)
      : await this.attachmentsService.uploadFromUrl(fileUrl as string);

    // Update the cell value
    const updateRecordRo: IUpdateRecordRo = {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: ((record.fields[fieldId] || []) as IAttachmentItem[]).concat(attachmentItem),
        },
      },
    };

    return await this.updateRecord(tableId, recordId, updateRecordRo);
  }

  async insertAttachment(
    tableId: string,
    recordId: string,
    fieldId: string,
    attachments: IAttachmentItem[],
    anchorId?: string
  ) {
    if (!attachments.length) {
      throw new CustomHttpException('No attachments provided', HttpErrorCode.VALIDATION_ERROR);
    }

    const record = await this.getValidateAttachmentRecord(tableId, recordId, fieldId);

    // Fetch full attachment data for each attachment item from database

    const current = (record.fields[fieldId] || []) as IAttachmentItem[];
    const anchorIndex = anchorId ? current.findIndex((item) => item.id === anchorId) : -1;
    const next =
      anchorIndex >= 0
        ? [...current.slice(0, anchorIndex + 1), ...attachments, ...current.slice(anchorIndex + 1)]
        : current.concat(attachments);

    const updateRecordRo: IUpdateRecordRo = {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: next,
        },
      },
    };

    return await this.updateRecord(tableId, recordId, updateRecordRo);
  }

  async duplicateRecord(
    tableId: string,
    recordId: string,
    order?: IRecordInsertOrderRo,
    projection?: string[]
  ) {
    const query = { fieldKeyType: FieldKeyType.Id, projection };
    const result = await this.recordService.getRecord(tableId, recordId, query);
    const records = { fields: result.fields };
    const createRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      order,
      records: [records],
    };
    return await this.prismaService
      .$tx(async () => this.createRecords(tableId, createRecordsRo))
      .then((res) => {
        return res.records[0];
      });
  }

  async buttonClick(tableId: string, recordId: string, fieldId: string) {
    const fieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: {
        id: fieldId,
        type: FieldType.Button,
        deletedTime: null,
      },
    });

    const fieldInstance = createFieldInstanceByRaw(fieldRaw);
    const options = fieldInstance.options as IButtonFieldOptions;
    const isActive = options.workflow && options.workflow.id && options.workflow.isActive;
    if (!isActive) {
      throw new CustomHttpException(
        `Button field's workflow ${options.workflow?.id} is not active`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.workflow.notActive',
          },
        }
      );
    }

    const maxCount = options.maxCount || 0;
    const record = await this.recordService.getRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
    });

    const fieldValue = record.fields[fieldId] as IButtonFieldCellValue;
    const count = fieldValue?.count || 0;
    if (maxCount > 0 && count >= maxCount) {
      throw new CustomHttpException(
        `Button click count ${count} reached max count ${maxCount}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.button.clickCountReachedMaxCount',
          },
        }
      );
    }
    const updatedRecord: IRecord = await this.updateRecord(tableId, recordId, {
      record: {
        fields: { [fieldId]: { count: count + 1 } },
      },
      fieldKeyType: FieldKeyType.Id,
    });
    updatedRecord.fields = pick(updatedRecord.fields, [fieldId]);

    return {
      tableId,
      fieldId,
      record: updatedRecord,
    };
  }

  async resetButton(tableId: string, recordId: string, fieldId: string) {
    const fieldRaw = await this.prismaService.txClient().field.findFirstOrThrow({
      where: {
        id: fieldId,
        type: FieldType.Button,
        deletedTime: null,
      },
    });

    const fieldInstance = createFieldInstanceByRaw(fieldRaw);
    const fieldOptions = fieldInstance.options as IButtonFieldOptions;
    if (!fieldOptions.resetCount) {
      throw new CustomHttpException(
        'Button field does not support reset',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.field.button.notSupportReset',
          },
        }
      );
    }

    return await this.updateRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: null,
        },
      },
    });
  }

  public async validateFieldsAndTypecast<
    T extends {
      fields: Record<string, unknown>;
    },
  >(
    tableId: string,
    records: T[],
    fieldKeyType: FieldKeyType = FieldKeyType.Name,
    typecast: boolean = false,
    ignoreMissingFields: boolean = false
  ) {
    const table = await this.tableDomainQueryService.getTableDomainById(tableId);
    return this.recordModifySharedService.validateFieldsAndTypecast(
      table,
      records,
      fieldKeyType,
      typecast,
      ignoreMissingFields
    );
  }

  async formSubmit(
    tableId: string,
    formSubmitRo: IFormSubmitRo,
    options?: { includeHiddenField?: boolean }
  ): Promise<IRecord> {
    const { viewId, fields, typecast } = formSubmitRo;
    const { includeHiddenField = false } = options ?? {};

    // 1. Validate view exists and is Form type
    await this.prismaService.view
      .findFirstOrThrow({
        where: { id: viewId, tableId, deletedTime: null, type: ViewType.Form },
      })
      .catch(() => {
        throw new CustomHttpException('View is not a form', HttpErrorCode.RESTRICTED_RESOURCE, {
          localization: {
            i18nKey: 'httpErrors.share.viewTypeNotAllowed',
          },
        });
      });

    // 2. Check field visibility - only allow submission of visible fields
    const visibleFields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId,
      filterHidden: !includeHiddenField,
    });
    const visibleFieldIdSet = new Set(visibleFields.map(({ id }) => id));

    if (
      (!visibleFields.length && !isEmpty(fields)) ||
      Object.keys(fields).some((fieldId) => !visibleFieldIdSet.has(fieldId))
    ) {
      throw new CustomHttpException(
        'The form contains hidden fields, submission not allowed.',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.hiddenFieldsSubmissionNotAllowed',
          },
        }
      );
    }

    // 3. Create record with form entry context
    const { records } = await this.prismaService.$tx(async () => {
      this.cls.set('entry', { type: 'form', id: viewId });
      this.cls.set('skipRecordAuditLog', true);
      return this.createRecords(tableId, {
        records: [{ fields }],
        fieldKeyType: FieldKeyType.Id,
        typecast,
      });
    });

    // 4. Emit form audit log
    await this.emitFormAuditLog(tableId, records.length);

    // 5. Validate record creation
    if (records.length === 0) {
      throw new CustomHttpException(
        'The number of successful submit records is 0',
        HttpErrorCode.INTERNAL_SERVER_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.share.submitRecordsError',
          },
        }
      );
    }

    return records[0];
  }

  private async emitFormAuditLog(tableId: string, length: number) {
    const userId = this.cls.get('user.id');
    const origin = this.cls.get('origin');

    await this.cls.run(async () => {
      this.cls.set('user.id', userId);
      this.cls.set('origin', origin!);
      await this.eventEmitterService.emitAsync(Events.TABLE_RECORD_CREATE_RELATIVE, {
        action: CreateRecordAction.FormSubmit,
        resourceId: tableId,
        recordCount: length,
      });
    });
  }
}
