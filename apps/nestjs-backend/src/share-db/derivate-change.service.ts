import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import type { ICellChange } from 'src/features/calculation/reference.service';
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
      const changes = transaction.changes;
      this.cleanTransaction(tsMeta);
      if (!changes.length) {
        return;
      }
      if (new Set(changes.map((c) => c.tableId)).size > 1) {
        throw new Error('Invalid changes, contains multiple tableId in 1 transaction');
      }
      const prisma = await this.transactionService.getTransaction(tsMeta);
      const derivateChanges = await this.linkService.getDerivateChangesByLink(
        prisma,
        changes[0].tableId,
        changes
      );

      const opsMap = this.linkService.formatOpsByChanges(derivateChanges);
      tsMeta = this.refreshTransactionCache(tsMeta, opsMap);
      return {
        opsMap,
        transactionMeta: tsMeta,
      };
    }
  }

  async getFixupOps(
    tsMeta: ITransactionMeta,
    tableId: string,
    recordId: string,
    ops: IOtOperation[]
  ): Promise<IOtOperation[] | undefined> {
    const prisma = await this.transactionService.getTransaction(tsMeta);

    const changes = ops.map<ICellChange>((op) => {
      const context = OpBuilder.editor.setRecord.detect(op);
      if (!context) {
        throw new Error('Invalid operation');
      }
      return {
        tableId: tableId,
        recordId: recordId,
        ...context,
      };
    });

    const linkOpsMap = this.linkService.formatOpsByChanges(changes);

    const calculated = await this.linkService.calculate(prisma, linkOpsMap);

    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    if (!calculated.length) {
      return;
    }

    const calculatedOps = calculated.map(this.linkService.changeToOp);

    transaction.changes.push(...changes);

    return calculatedOps;
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
