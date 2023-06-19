import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { ICellChange } from 'src/features/calculation/reference.service';
import type { IOpsMap } from '../features/calculation/link.service';
import { LinkService } from '../features/calculation/link.service';
import { TransactionService } from './transaction.service';
import type { ITransactionMeta } from './transaction.service';

@Injectable()
export class DerivateChangeService {
  constructor(
    private readonly linkService: LinkService,
    private readonly transactionService: TransactionService
  ) {}

  private transactions: Map<
    string,
    {
      opsMaps: IOpsMap[];
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
        opsMaps: [],
      });
    }
  }

  cleanTransaction(tsMeta: ITransactionMeta) {
    this.transactions.delete(tsMeta.transactionKey);
  }

  getOpsToOthers(tsMeta: ITransactionMeta) {
    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.counter === tsMeta.opCount) {
      this.cleanTransaction(tsMeta);
      if (!transaction.opsMaps.length) {
        return;
      }

      const otherSnapshotOps = this.linkService.composeOpsMaps(transaction.opsMaps);
      tsMeta = this.refreshTransactionCache(tsMeta, otherSnapshotOps);
      return {
        otherSnapshotOps,
        transactionMeta: tsMeta,
      };
    }
  }

  private async calculate(
    prisma: Prisma.TransactionClient,
    tableId: string,
    recordId: string,
    ops: IOtOperation[],
    changes: ICellChange[]
  ) {
    const linkOpsMap = this.linkService.formatOpsByChanges(changes);
    if (!linkOpsMap[tableId]) {
      linkOpsMap[tableId] = {};
    }
    if (!linkOpsMap[tableId][recordId]) {
      linkOpsMap[tableId][recordId] = ops;
    } else {
      linkOpsMap[tableId][recordId].push(...ops);
    }

    return await this.linkService.calculate(prisma, linkOpsMap);
  }

  async getFixupOps(
    tsMeta: ITransactionMeta,
    tableId: string,
    recordId: string,
    ops: IOtOperation[]
  ): Promise<IOtOperation[] | undefined> {
    const prisma = await this.transactionService.getTransaction(tsMeta);
    const changes = await this.linkService.getDerivateChangesByLink(
      prisma,
      tableId,
      ops.map((op) => {
        const context = OpBuilder.editor.setRecord.detect(op);
        if (!context) {
          throw new Error('Invalid operation');
        }
        return {
          id: recordId,
          ...context,
        };
      })
    );
    const calculated = await this.calculate(prisma, tableId, recordId, ops, changes);

    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    if (!calculated) {
      return;
    }

    const opsMap = this.linkService.formatOpsByChanges(changes.concat(calculated));
    const currentSnapshotOps = opsMap[tableId]?.[recordId];

    if (currentSnapshotOps) {
      delete opsMap[tableId][recordId];
      if (!Object.keys(opsMap[tableId])) {
        delete opsMap[tableId];
      }
    }

    Object.keys(opsMap) && transaction.opsMaps.push(opsMap);

    return currentSnapshotOps;
  }

  refreshTransactionCache(
    tsMeta: ITransactionMeta,
    otherSnapshotOps: { [tableId: string]: { [recordId: string]: IOtOperation[] } }
  ) {
    const opsCount = Object.values(otherSnapshotOps).reduce((pre, cur) => {
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
