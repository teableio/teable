import { Injectable, Logger } from '@nestjs/common';
import type { IFieldVo } from '@teable-group/core';
import { FieldOpBuilder, getUniqName, IdPrefix, FieldType } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { Connection } from '@teable/sharedb/lib/client';
import { instanceToPlain } from 'class-transformer';
import type { IRawOpMap } from '../../../share-db/interface';
import { ShareDbService } from '../../../share-db/share-db.service';
import { TransactionService } from '../../../share-db/transaction.service';
import { FieldCalculationService } from '../../calculation/field-calculation.service';
import { FieldSupplementService } from '../field-supplement.service';
import type { IFieldInstance } from '../model/factory';

@Injectable()
export class FieldCreatingService {
  private logger = new Logger(FieldCreatingService.name);

  constructor(
    private readonly shareDbService: ShareDbService,
    private readonly transactionService: TransactionService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly fieldCalculationService: FieldCalculationService
  ) {}

  async uniqFieldName(prisma: Prisma.TransactionClient, tableId: string, field: IFieldVo) {
    const fieldRaw = await prisma.field.findMany({
      where: { tableId, deletedTime: null },
      select: { name: true },
    });

    const names = fieldRaw.map((item) => item.name);
    const uniqName = getUniqName(field.name, names);
    if (uniqName !== field.name) {
      return {
        ...field,
        name: uniqName,
      };
    }
    return field;
  }

  async createAndCalculate(
    connection: Connection,
    prisma: Prisma.TransactionClient,
    tableId: string,
    field: IFieldInstance
  ) {
    await this.fieldSupplementService.createReference(prisma, field);

    const snapshot = await this.uniqFieldName(
      prisma,
      tableId,
      this.createField2Ops(tableId, field)
    );

    const id = snapshot.id;
    const collection = `${IdPrefix.Field}_${tableId}`;
    await this.createDoc(connection, collection, snapshot);
    let rawOpsMap: IRawOpMap | undefined;
    if (field.isComputed) {
      // src is a unique id for the client used by sharedb
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const src = (connection.agent as any).clientId;
      rawOpsMap = await this.fieldCalculationService.calculateFields(prisma, src, tableId, [id]);
    }

    const { dbFieldName } = await prisma.field.findUniqueOrThrow({
      where: { id },
      select: { dbFieldName: true },
    });
    return {
      snapshot: { ...snapshot, dbFieldName },
      rawOpsMap,
    };
  }

  async createField(
    transactionKey: string,
    tableId: string,
    field: IFieldInstance
  ): Promise<IFieldVo> {
    const prisma = this.transactionService.getTransactionSync(transactionKey);
    const connection = this.shareDbService.getConnection(transactionKey);

    if (field.type === FieldType.Link && !field.isLookup) {
      await this.fieldSupplementService.createForeignKey(prisma, tableId, field);
      const symmetricField = await this.fieldSupplementService.generateSymmetricField(
        prisma,
        tableId,
        field
      );

      const result1 = await this.createAndCalculate(connection, prisma, tableId, field);
      const result2 = await this.createAndCalculate(
        connection,
        prisma,
        field.options.foreignTableId,
        symmetricField
      );
      result1.rawOpsMap && this.shareDbService.publishOpsMap(result1.rawOpsMap);
      result2.rawOpsMap && this.shareDbService.publishOpsMap(result2.rawOpsMap);
      return result1.snapshot;
    }
    const result = await this.createAndCalculate(connection, prisma, tableId, field);
    result.rawOpsMap && this.shareDbService.publishOpsMap(result.rawOpsMap);
    return result.snapshot;
  }

  private async createDoc(
    connection: Connection,
    collection: string,
    createSnapshot: IFieldVo
  ): Promise<IFieldVo> {
    const doc = connection.get(collection, createSnapshot.id);
    return new Promise<IFieldVo>((resolve, reject) => {
      doc.create(createSnapshot, (error) => {
        if (error) return reject(error);
        this.logger.log(`create document ${collection}.${createSnapshot.id} succeed!`);
        resolve(doc.data);
      });
    });
  }

  createField2Ops(_tableId: string, fieldInstance: IFieldInstance) {
    return FieldOpBuilder.creator.build(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      instanceToPlain(fieldInstance, { excludePrefixes: ['_'] }) as IFieldVo
    );
  }
}
