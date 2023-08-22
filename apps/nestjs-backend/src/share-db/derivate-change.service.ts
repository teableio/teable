import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { RecordOpBuilder } from '@teable-group/core';
import { LinkService } from '../features/calculation/link.service';
import { ReferenceService } from '../features/calculation/reference.service';
import type { IOpsMap } from '../features/calculation/reference.service';
import type { ICellChange } from '../features/calculation/utils/changes';
import { formatChangesToOps } from '../features/calculation/utils/changes';
import { composeMaps } from '../features/calculation/utils/compose-maps';
import { TransactionService } from './transaction.service';
import type { ITransactionMeta } from './transaction.service';

@Injectable()
export class DerivateChangeService {
  constructor(
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService,
    private readonly transactionService: TransactionService
  ) {}

  private transactions: Map<
    string,
    {
      changes: ICellChange[];
      counter: number;
    }
  > = new Map();

  countTransaction(tsMeta: ITransactionMeta) {
    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (transaction) {
      transaction.counter++;
    } else {
      this.transactions.set(tsMeta.transactionKey, {
        counter: 1,
        changes: [],
      });
    }
  }

  cleanTransaction(tsMeta: ITransactionMeta) {
    this.transactions.delete(tsMeta.transactionKey);
  }

  async derivateAndCalculateLink(tsMeta: ITransactionMeta) {
    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.counter === tsMeta.opCount) {
      const { changes } = transaction;
      this.cleanTransaction(tsMeta);
      if (new Set(changes.map((c) => c.tableId)).size > 1) {
        throw new Error('Invalid changes, contains multiple tableId in 1 transaction');
      }

      const prisma = await this.transactionService.getTransaction(tsMeta);
      const opsMaps: IOpsMap[] = [];

      if (changes.length) {
        const derivate = await this.linkService.getDerivateByLink(
          prisma,
          changes[0].tableId,
          changes
        );
        const cellChanges = derivate?.cellChanges || [];
        const fkRecordMap = derivate?.fkRecordMap || {};

        const opsMapOrigin = formatChangesToOps(changes);
        const opsMapByLink = formatChangesToOps(cellChanges);
        const { opsMap: opsMapByCalculate } = await this.referenceService.calculateOpsMap(
          prisma,
          composeMaps([opsMapOrigin, opsMapByLink]),
          fkRecordMap
        );
        opsMaps.push(opsMapByLink, opsMapByCalculate);
      }

      // compose opsMap from origin calculation and derivateChanges calculation
      const finalOpsMap = composeMaps(opsMaps);
      tsMeta = this.refreshTransactionCache(tsMeta, finalOpsMap);

      return {
        opsMap: finalOpsMap,
        transactionMeta: tsMeta,
      };
    }
  }

  cacheChanges(tsMeta: ITransactionMeta, tableId: string, recordId: string, ops: IOtOperation[]) {
    const changes = ops.map<ICellChange>((op) => {
      const context = RecordOpBuilder.editor.setRecord.detect(op);
      if (!context) {
        throw new Error('Invalid operation');
      }
      return {
        tableId: tableId,
        recordId: recordId,
        ...context,
      };
    });

    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    transaction.changes.push(...changes);
  }

  refreshTransactionCache(
    tsMeta: ITransactionMeta,
    opsMap: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
    const opsCount = Object.values(opsMap).reduce((pre, cur) => {
      pre += Object.keys(cur).length;
      return pre;
    }, 0);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const existingOpCount = this.transactionService.getCache(tsMeta.transactionKey)!.opCount!;

    const transactionMeta: ITransactionMeta = {
      transactionKey: tsMeta.transactionKey,
      // increase opCount by changes
      opCount: existingOpCount + opsCount,
      // avoid recalculate
      skipCalculate: true,
    };

    this.transactionService.updateTransaction(transactionMeta);
    return transactionMeta;
  }
}
