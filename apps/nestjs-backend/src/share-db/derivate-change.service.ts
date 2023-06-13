import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import type { IApplyParam, IOpsMap } from '../features/calculation/link.service';
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

  async getFixupOps(
    tsMeta: ITransactionMeta,
    data: IApplyParam
  ): Promise<IOtOperation[] | undefined> {
    const prisma = await this.transactionService.getTransaction(tsMeta);
    const calculated = await this.linkService.calculate(prisma, data);
    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    if (!calculated) {
      return;
    }
    const { currentSnapshotOps, otherSnapshotOps } = calculated;

    otherSnapshotOps && transaction.opsMaps.push(otherSnapshotOps);

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
