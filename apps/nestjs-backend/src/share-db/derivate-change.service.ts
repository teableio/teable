import { Injectable } from '@nestjs/common';
import type { IOtOperation, ISetRecordOpContext } from '@teable-group/core';
import { OpBuilder } from '@teable-group/core';
import { ReferenceService } from '../features/calculation/reference.service';
import type { ICellChange } from '../features/calculation/reference.service';
import { TransactionService } from './transaction.service';
import type { ITransactionMeta } from './transaction.service';

@Injectable()
export class DerivateChangeService {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly referenceService: ReferenceService
  ) {}

  private changeToOp(change: ICellChange) {
    const { fieldId, oldValue, newValue } = change;
    return OpBuilder.editor.setRecord.build({
      fieldId,
      oldCellValue: oldValue,
      newCellValue: newValue,
    });
  }

  private getOpsByChanges(tableId: string, recordId: string, changes: ICellChange[]) {
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
      otherSnapshotOps,
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
    const existingOpCount = this.transactionService.transactionCache.get(
      tsMeta.transactionKey
    )!.opCount;

    const transactionMeta = {
      transactionKey: tsMeta.transactionKey,
      // increase opCount by changes
      opCount: opsCount + existingOpCount,
      // avoid recalculate
      skipCalculate: true,
    };

    this.transactionService.updateTransaction(transactionMeta);
    return transactionMeta;
  }

  async getFixupOps(
    tsMeta: ITransactionMeta,
    tableId: string,
    recordId: string,
    opContexts: ISetRecordOpContext[]
  ) {
    const prisma = await this.transactionService.getTransaction(tsMeta);
    let derivateChanges: ICellChange[] = [];
    for (const opContext of opContexts) {
      const { fieldId, newValue } = opContext;
      const changes = await this.referenceService.updateNodeValues(prisma, tableId, fieldId, [
        { id: recordId, newValue },
      ]);
      if (!changes.length) {
        continue;
      }
      derivateChanges = derivateChanges.concat(changes);
    }
    if (!derivateChanges.length) {
      return;
    }

    const { currentSnapshotOps, otherSnapshotOps } = this.getOpsByChanges(
      tableId,
      recordId,
      derivateChanges
    );

    const transactionMeta = this.refreshTransactionCache(tsMeta, otherSnapshotOps);
    return { currentSnapshotOps, otherSnapshotOps, transactionMeta };
  }
}
