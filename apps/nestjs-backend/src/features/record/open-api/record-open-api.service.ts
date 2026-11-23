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
import { CreateRecordAction, ICreateRecordsRo, IUpdateRecordsRo } from '@teable/openapi';
import type {
  ICreateRecordsVo,
  IFormSubmitRo,
  IRecord,
  IRecordInsertOrderRo,
  IUpdateRecordRo,
} from '@teable/openapi';
import { isEmpty, pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import { CustomHttpException } from '../../../custom.exception';
import { EventEmitterService } from '../../../event-emitter/event-emitter.service';
import { Events } from '../../../event-emitter/events';
import { DataDbClientManager } from '../../../global/data-db-client-manager.service';
import { V1EngineService } from '../../../tracing/decorators/v1-engine';
import type { IClsStore } from '../../../types/cls';
import { retryOnDeadlock } from '../../../utils/retry-decorator';
import { AttachmentsService } from '../../attachments/attachments.service';
import { AuditScope } from '../../audit/audit-scope';
import { Audit } from '../../audit/audit.decorator';
import { FieldService } from '../../field/field.service';
import { createFieldInstanceByRaw } from '../../field/model/factory';
import { TableDomainQueryService } from '../../table-domain';
import { RecordModifyService } from '../record-modify/record-modify.service';
import { RecordModifySharedService } from '../record-modify/record-modify.shared.service';
import type { IRecordInnerRo } from '../record.service';
import { RecordService } from '../record.service';
import type { IUpdateRecordsInternalRo } from '../type';

@V1EngineService([
  'multipleCreateRecords',
  'createRecordsOnlySql',
  'createRecords',
  'updateRecords',
  'simpleUpdateRecords',
  'updateRecord',
  'deleteRecord',
  'deleteRecords',
  'uploadAttachment',
  'insertAttachment',
  'duplicateRecord',
  'buttonClick',
  'resetButton',
  'formSubmit',
])
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
    private readonly eventEmitterService: EventEmitterService,
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly audit: AuditScope
  ) {}

  @retryOnDeadlock()
  async multipleCreateRecords(
    tableId: string,
    createRecordsRo: ICreateRecordsRo,
    ignoreMissingFields: boolean = false,
    // Kept for API compat; ignored — AI source is set by middleware now, user.id stays real.
    _isAiInternal?: string
  ): Promise<ICreateRecordsVo> {
    return this.prismaService.$tx(
      async () =>
        this.recordModifyService.multipleCreateRecords(
          tableId,
          createRecordsRo,
          ignoreMissingFields
        ),
      { timeout: this.thresholdConfig.bigTransactionTimeout }
    );
  }

  /**
   * Create records via raw SQL only (no ops, no events). Used by CSV import (new-table
   * path) where the worker has set an Import / InplaceImport scope. Since raw SQL
   * bypasses v2 / v1 event emission, we emit one atomic record-create row per chunk via
   * the `@Audit` atomic emit mode (uses the caller's active operation; no-op if none).
   */
  @Audit({
    action: Events.TABLE_RECORD_CREATE,
    // Target table explicitly: the ambient operation's resourceId can be the
    // import's base or a duplication's SOURCE table, which would mis-scope
    // downstream consumers (audit rows + analytics aggregation).
    resourceId: (tableId: string) => tableId,
    emit: (_result, _tableId, createRecordsRo: ICreateRecordsRo) => ({
      recordCount: createRecordsRo.records.length,
    }),
  })
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
    _isAiInternal?: string
  ) {
    return this.recordModifyService.updateRecords(
      tableId,
      updateRecordsRo as IUpdateRecordsInternalRo,
      windowId
    );
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
    const isActive = options.workflow?.id && options.workflow.isActive;
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
    const { records } = await this.formSubmitCreateRecords(tableId, viewId, fields, typecast);

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

  @Audit({
    rootAction: CreateRecordAction.FormSubmit,
    resourceId: (tableId: string) => tableId,
  })
  private async formSubmitCreateRecords(
    tableId: string,
    viewId: string,
    fields: IFormSubmitRo['fields'],
    typecast?: boolean
  ): Promise<ICreateRecordsVo> {
    return this.prismaService.$tx(async () => {
      this.cls.set('entry', { type: 'form', id: viewId });
      return this.createRecords(tableId, {
        records: [{ fields }],
        fieldKeyType: FieldKeyType.Id,
        typecast,
      });
    });
  }
}
