import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Field, PrismaService } from '@teable/db-main-prisma';
import { IUserInfoVo } from '@teable/openapi';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { Events } from '../../event-emitter/events';
import { Timing } from '../../utils/timing';

@Injectable()
export class UserNameListener {
  private readonly logger = new Logger(UserNameListener.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventEmitterService: EventEmitterService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  private async getFieldsForUser(userId: string) {
    const query = this.knex('collaborator')
      .join('space', 'collaborator.space_id', 'space.id')
      .join('base', 'space.id', 'base.space_id')
      .join('table_meta', 'base.id', 'table_meta.base_id')
      .join('field', 'table_meta.id', 'field.table_id')
      .where('collaborator.user_id', userId)
      .whereIn('field.type', ['user', 'createdBy', 'lastModifiedBy'])
      .whereNull('collaborator.deleted_time')
      .whereNull('space.deleted_time')
      .whereNull('base.deleted_time')
      .whereNull('table_meta.deleted_time')
      .whereNull('field.deleted_time')
      .select({
        id: 'field.id',
        tableId: 'field.table_id',
        type: 'field.type',
        dbFieldName: 'field.db_field_name',
        isMultipleCellValue: 'field.is_multiple_cell_value',
      })
      .toQuery();

    return this.prismaService.$queryRawUnsafe<Field[]>(query);
  }

  @Timing()
  private async updateUserFieldName(field: Field, id: string, name: string) {
    const tableId = field.tableId;
    const { dbTableName } = await this.prismaService.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });

    const sql = field.isMultipleCellValue
      ? this.dbProvider.updateJsonArrayColumn(dbTableName, field.dbFieldName, id, 'title', name)
      : this.dbProvider.updateJsonColumn(dbTableName, field.dbFieldName, id, 'title', name);

    return await this.prismaService.$executeRawUnsafe(sql);
  }

  @OnEvent(Events.USER_RENAME, { async: true })
  async updateUserName(user: IUserInfoVo) {
    const fields = await this.getFieldsForUser(user.id);

    this.logger.log(`Updating user name for ${fields.length} fields`);

    for (const field of fields) {
      try {
        await this.updateUserFieldName(field, user.id, user.name);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        this.logger.error(e.message, e.stack);
      }
    }

    this.eventEmitterService.emit(Events.TABLE_USER_RENAME_COMPLETE, user);
  }
}
