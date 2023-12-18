import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IUserCellValue } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { NotificationService } from '../../features/notification/notification.service';
import type { IChangeRecord, RecordCreateEvent, RecordUpdateEvent } from '../model';
import { Events } from '../model';

type IListenerEvent = RecordCreateEvent | RecordUpdateEvent;

type IUserField = {
  baseId: string;
  tableName: string;
  fieldId: string;
  fieldName: string;
  fieldOptions: string;
};

@Injectable()
export class CollaboratorNotificationListener {
  private readonly logger = new Logger(CollaboratorNotificationListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly notificationService: NotificationService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  @OnEvent(Events.TABLE_RECORD_CREATE, { async: true })
  @OnEvent(Events.TABLE_RECORD_UPDATE, { async: true })
  private async listener(listenerEvent: IListenerEvent): Promise<void> {
    const { name: eventName, tableId } = listenerEvent;

    const userFieldData = await this.fetchUserFields(tableId);
    if (!userFieldData.length) {
      return;
    }

    const userFields = keyBy(userFieldData, 'fieldId');
    const userFieldIds = Object.keys(userFields);

    if (eventName === Events.TABLE_RECORD_CREATE) {
      this.logger.log('Wait a moment');
    } else if (eventName === Events.TABLE_RECORD_UPDATE) {
      await this.processTableRecordUpdate(
        listenerEvent as RecordUpdateEvent,
        userFieldIds,
        userFields
      );
    }
  }

  private async processTableRecordUpdate(
    event: RecordUpdateEvent,
    userFieldIds: string[],
    userFields: Record<string, IUserField>
  ): Promise<void> {
    const {
      tableId,
      context: { user },
      record: eventRecords,
    } = event;
    const recordSets = (Array.isArray(eventRecords) ? eventRecords : [eventRecords]).filter(
      Boolean
    ) as IChangeRecord[];

    const notificationData = this.extractNotificationData(recordSets, userFieldIds);

    for (const userId in notificationData) {
      const { fieldId, recordIds } = notificationData[userId];
      const field = userFields[fieldId];

      await this.notificationService.sendCollaboratorNotify({
        fromUserId: user?.id || '',
        toUserId: userId,
        refRecord: {
          baseId: field.baseId,
          tableId: tableId,
          tableName: field.tableName,
          fieldName: field.fieldName,
          recordIds: recordIds,
        },
      });
    }
  }

  private extractNotificationData(
    records: IChangeRecord[],
    userFieldIds: string[]
  ): Record<string, { fieldId: string; recordIds: string[] }> {
    return records.reduce<Record<string, { fieldId: string; recordIds: string[] }>>(
      (acc, record) => {
        const { id: recordId, fields: changeFields } = record;

        if (!recordId || !changeFields) {
          return acc;
        }

        Object.entries(changeFields).forEach(([fieldId, value]) => {
          if (userFieldIds.includes(fieldId) && value.newValue) {
            const collaborators = Array.isArray(value.newValue) ? value.newValue : [value.newValue];

            collaborators.forEach((collaborator: IUserCellValue) => {
              const userId = collaborator.id;
              if (!acc[userId]) {
                acc[userId] = { fieldId, recordIds: [recordId] };
              } else {
                acc[userId].recordIds.push(recordId);
              }
            });
          }
        });
        return acc;
      },
      {}
    );
  }

  private async fetchUserFields(tableId: string) {
    const getTableAllUserFieldSql = this.knex
      .select({
        baseId: 'tm.base_id',
        tableName: 'tm.name',
        fieldId: 'f.id',
        fieldName: 'f.name',
        fieldOptions: 'f.options',
      })
      .from(this.knex.ref('table_meta').as('tm'))
      .join(this.knex.ref('field').as('f'), (clause) => {
        clause.on('tm.id', 'f.table_id').andOnNull('tm.deleted_time').andOnNull('f.deleted_time');
      })
      .where('f.table_id', tableId)
      .andWhere('f.type', FieldType.User);

    const userFieldRaws = await this.prismaService
      .txClient()
      .$queryRawUnsafe<IUserField[]>(getTableAllUserFieldSql.toQuery());

    // Filtering member fields that don't need to be notified based on `options.shouldNotify`
    return userFieldRaws.filter(({ fieldOptions }) => {
      const options = JSON.parse(fieldOptions);
      return options && options?.shouldNotify;
    });
  }
}
