import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { IUserCellValue } from '@teable-group/core';
import { FieldType } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { keyBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { NotificationService } from '../../features/notification/notification.service';
import type { RecordCreateEvent, RecordUpdateEvent } from '../model';
import { Events } from '../model';

type IListenerEvent = RecordCreateEvent | RecordUpdateEvent;

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

    const userFieldRaws = await this.getTableAllUserField(tableId);
    if (!userFieldRaws.length) {
      return;
    }

    const userFields = keyBy(userFieldRaws, 'fieldId');
    const userFieldIds = Object.keys(userFields);

    if (eventName === Events.TABLE_RECORD_CREATE) {
      console.log('1');
    } else if (eventName === Events.TABLE_RECORD_UPDATE) {
      const event = listenerEvent as RecordUpdateEvent;
      const { user } = event.context;
      const eventSets = Array.isArray(event.record) ? event.record : [event.record];

      const notifyUserSets = eventSets.reduce<
        Record<string, { fieldId: string; recordIds: string[] }>
      >((acc, changeRecord) => {
        const changeRecordId = changeRecord?.id;
        const changeFields = changeRecord?.fields;

        if (!changeRecordId || !changeFields) {
          return acc;
        }

        for (const [fieldId, value] of Object.entries(changeFields)) {
          if (userFieldIds.includes(fieldId) && value.newValue) {
            const collaborators = (
              Array.isArray(value.newValue) ? value.newValue : [value.newValue]
            ) as IUserCellValue[];

            collaborators.forEach(({ id }) => {
              if (!acc[id]) {
                acc[id] = { fieldId, recordIds: [changeRecordId] };
              } else {
                acc[id].recordIds.push(changeRecordId);
              }
            });
          }
        }

        return acc;
      }, {});

      for (const userId in notifyUserSets) {
        const { fieldId, recordIds } = notifyUserSets[userId];
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
  }

  private async getTableAllUserField(tableId: string) {
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

    const userFieldRaws = await this.prismaService.txClient().$queryRawUnsafe<
      {
        baseId: string;
        tableName: string;
        fieldId: string;
        fieldName: string;
        fieldOptions: string;
      }[]
    >(getTableAllUserFieldSql.toQuery());

    // Filtering member fields that don't need to be notified based on `options.shouldNotify`
    return userFieldRaws.filter(({ fieldOptions }) => {
      const options = JSON.parse(fieldOptions);
      return options && options?.shouldNotify;
    });
  }
}
