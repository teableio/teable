import { Injectable } from '@nestjs/common';
import type { IOtOperation } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import { LinkService } from '../features/calculation/link.service';
import { ReferenceService } from '../features/calculation/reference.service';
import type { ICellChange, IOpsMap } from '../features/calculation/reference.service';
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
        changes: [],
        opsMaps: [],
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
      const { changes, opsMaps } = transaction;
      this.cleanTransaction(tsMeta);
      if (new Set(changes.map((c) => c.tableId)).size > 1) {
        throw new Error('Invalid changes, contains multiple tableId in 1 transaction');
      }

      const prisma = await this.transactionService.getTransaction(tsMeta);

      if (changes.length) {
        const derivateChanges = await this.linkService.getDerivateChangesByLink(
          prisma,
          changes[0].tableId,
          changes
        );

        const derivateOpsMap = this.linkService.formatOpsByChanges(derivateChanges);
        opsMaps.push(derivateOpsMap);
        const calculated = await this.referenceService.calculateOpsMap(prisma, derivateOpsMap);
        const calculatedOpsMap = this.linkService.formatOpsByChanges(calculated);
        opsMaps.push(calculatedOpsMap);
      }

      // compose opsMap from origin calculation and derivateChanges calculation
      const finalOpsMap = this.linkService.composeMaps(opsMaps);
      tsMeta = this.refreshTransactionCache(tsMeta, finalOpsMap);

      return {
        opsMap: finalOpsMap,
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

    const calculated = await this.referenceService.calculateOpsMap(
      prisma,
      this.linkService.formatOpsByChanges(changes)
    );

    const calculatedOpsMap = this.linkService.formatOpsByChanges(calculated);

    const transaction = this.transactions.get(tsMeta.transactionKey);
    if (!transaction) {
      throw new Error('Transaction not found');
    }
    transaction.changes.push(...changes);

    if (!calculated.length) {
      return;
    }

    // we should cache ops from other snapshot and return ops from current snapshot
    const fixUpOps: IOtOperation[] | undefined = calculatedOpsMap[tableId]?.[recordId];
    if (fixUpOps) {
      delete calculatedOpsMap[tableId][recordId];
    }
    transaction.opsMaps.push(calculatedOpsMap);

    return fixUpOps;
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
