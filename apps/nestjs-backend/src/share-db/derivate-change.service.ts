import { Injectable } from '@nestjs/common';
import type { IOtOperation, ISetRecordOpContext } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import { groupBy } from 'lodash';
import type { ICellContext } from '../features/calculation/link.service';
import { LinkService } from '../features/calculation/link.service';
import { ReferenceService } from '../features/calculation/reference.service';
import type { ICellChange } from '../features/calculation/reference.service';
import { TransactionService } from './transaction.service';
import type { ITransactionMeta } from './transaction.service';

interface IOpsMap {
  [tableId: string]: {
    [recordId: string]: IOtOperation[];
  };
}

interface IApplyParam {
  tableId: string;
  recordId: string;
  opContexts: ISetRecordOpContext[];
}

@Injectable()
export class DerivateChangeService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly linkService: LinkService,
    private readonly referenceService: ReferenceService
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

      console.log('transaction.opsMaps', transaction.opsMaps);
      const otherSnapshotOps = this.composeOpsMaps(transaction.opsMaps);
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
    const calculated = await this.calculate(tsMeta, data);
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

  private composeOpsMaps(opsMaps: IOpsMap[]): IOpsMap {
    return opsMaps.reduce((composedMap, currentMap) => {
      for (const tableId in currentMap) {
        if (composedMap[tableId]) {
          for (const recordId in currentMap[tableId]) {
            if (composedMap[tableId][recordId]) {
              composedMap[tableId][recordId] = composedMap[tableId][recordId].concat(
                currentMap[tableId][recordId]
              );
            } else {
              composedMap[tableId][recordId] = currentMap[tableId][recordId];
            }
          }
        } else {
          composedMap[tableId] = currentMap[tableId];
        }
      }
      return composedMap;
    }, {});
  }

  private changeToOp(change: ICellChange) {
    const { fieldId, oldValue, newValue } = change;
    return OpBuilder.editor.setRecord.build({
      fieldId,
      oldCellValue: oldValue,
      newCellValue: newValue,
    });
  }

  private formatOpsByChanges(tableId: string, recordId: string, changes: ICellChange[]) {
    const currentSnapshotOps: IOtOperation[] = [];
    const otherSnapshotOps = changes.reduce<{
      [tableId: string]: { [recordId: string]: IOtOperation[] };
    }>((pre, cur) => {
      const { tableId: curTableId, recordId: curRecordId } = cur;
      const op = this.changeToOp(cur);

      if (curTableId === tableId && curRecordId === recordId) {
        currentSnapshotOps.push(op);
        return pre;
      }

      if (!pre[curTableId]) {
        pre[curTableId] = {};
      }
      if (!pre[curTableId][curRecordId]) {
        pre[curTableId][curRecordId] = [];
      }
      pre[curTableId][curRecordId].push(op);

      return pre;
    }, {});

    return {
      currentSnapshotOps,
      otherSnapshotOps: Object.keys(otherSnapshotOps).length ? otherSnapshotOps : undefined,
    };
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
    const existingOpCount = this.transactionService.getCache(tsMeta.transactionKey)!.opCount;

    const transactionMeta: ITransactionMeta = {
      transactionKey: tsMeta.transactionKey,
      // increase opCount by changes
      opCount: opsCount + existingOpCount,
      // avoid recalculate
      skipCalculate: true,
    };

    this.transactionService.updateTransaction(transactionMeta);
    return transactionMeta;
  }

  async calculate(tsMeta: ITransactionMeta, param: IApplyParam) {
    const prisma = await this.transactionService.getTransaction(tsMeta);
    const { tableId, recordId } = param;

    const recordData = param.opContexts.map((ctx) => {
      return {
        id: recordId,
        fieldId: ctx.fieldId,
        newValue: ctx.newValue,
        oldValue: ctx.oldValue,
      };
    });

    const derivateChangesByLink = await this.linkService.getDerivateChangesByLink(
      prisma,
      tableId,
      recordData as ICellContext[]
    );

    const derivateChangesMap = groupBy(derivateChangesByLink, 'tableId');
    const recordDataByLink = derivateChangesMap[tableId]?.map(
      ({ recordId, fieldId, newValue, oldValue }) => ({
        id: recordId,
        fieldId,
        newValue,
        oldValue,
      })
    );
    delete derivateChangesMap[tableId];

    // recordData should concat link change in current table
    let derivateChanges = await this.referenceService.calculate(
      prisma,
      tableId,
      recordData.concat(recordDataByLink)
    );

    derivateChanges = derivateChanges.concat(derivateChangesByLink);

    for (const tableId in derivateChangesMap) {
      const recordData = derivateChangesMap[tableId].map(
        ({ recordId, fieldId, newValue, oldValue }) => ({
          id: recordId,
          fieldId,
          newValue,
          oldValue,
        })
      );
      const changes = await this.referenceService.calculate(prisma, tableId, recordData);
      derivateChanges = derivateChanges.concat(changes);
    }

    if (!derivateChanges.length) {
      return;
    }

    console.log('derivateChanges:', derivateChanges);

    return this.formatOpsByChanges(tableId, recordId, derivateChanges);
  }
}
