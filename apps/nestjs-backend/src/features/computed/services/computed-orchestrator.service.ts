import { Injectable } from '@nestjs/common';
import { IdPrefix, RecordOpBuilder } from '@teable/core';
import { RawOpType } from '../../../share-db/interface';
import { BatchService } from '../../calculation/batch.service';
import type { ICellContext } from '../../calculation/utils/changes';
import { ComputedDependencyCollectorService } from './computed-dependency-collector.service';
import { ComputedEvaluatorService } from './computed-evaluator.service';

@Injectable()
export class ComputedOrchestratorService {
  constructor(
    private readonly collector: ComputedDependencyCollectorService,
    private readonly evaluator: ComputedEvaluatorService,
    private readonly batchService: BatchService
  ) {}

  /**
   * Publish-only computed pipeline executed within the current transaction.
   * - Collects affected computed fields across tables via dependency closure (SQL CTE).
   * - Resolves impacted recordIds per table (same-table = changed records; cross-table = link backrefs).
   * - Reads latest values via RecordService snapshots (projection of impacted computed fields).
   * - Builds setRecord ops and saves them as raw ops; no DB writes, no __version bump here.
   * - Raw ops are picked up by ShareDB publisher after the outer tx commits.
   *
   * Returns: { publishedOps } — total number of field set ops enqueued.
   */
  async run(
    tableId: string,
    cellContexts: ICellContext[]
  ): Promise<{
    publishedOps: number;
    impact: Record<string, { fieldIds: string[]; recordIds: string[] }>;
  }> {
    if (!cellContexts?.length) return { publishedOps: 0, impact: {} };
    const basicCtx = cellContexts.map((c) => ({ recordId: c.recordId, fieldId: c.fieldId }));
    const impact = await this.collector.collect(tableId, basicCtx);
    const impactedTables = Object.keys(impact);
    if (!impactedTables.length) return { publishedOps: 0, impact: {} };

    for (const tid of impactedTables) {
      const group = impact[tid];
      if (!group.fieldIds.size || !group.recordIds.size) delete impact[tid];
    }
    if (!Object.keys(impact).length) return { publishedOps: 0, impact: {} };

    const evaluated = await this.evaluator.evaluate(impact);

    const tasks = Object.entries(evaluated).map(async ([tid, recs]) => {
      const recordIds = Object.keys(recs);
      if (!recordIds.length) return 0;

      const opDataList = recordIds
        .map((rid) => {
          const { version, fields } = recs[rid];
          const ops = Object.entries(fields).map(([fid, value]) =>
            RecordOpBuilder.editor.setRecord.build({
              fieldId: fid,
              newCellValue: value,
              oldCellValue: undefined,
            })
          );
          if (version == null) return null;
          return { docId: rid, version, data: ops, count: ops.length } as const;
        })
        .filter(Boolean) as { docId: string; version: number; data: unknown; count: number }[];

      if (!opDataList.length) return 0;

      this.batchService.saveRawOps(
        tid,
        RawOpType.Edit,
        IdPrefix.Record,
        opDataList.map(({ docId, version, data }) => ({ docId, version, data }))
      );

      return opDataList.reduce((sum, x) => sum + x.count, 0);
    });

    const counts = await Promise.all(tasks);
    const total = counts.reduce((a, b) => a + b, 0);

    const resultImpact = Object.entries(impact).reduce<
      Record<string, { fieldIds: string[]; recordIds: string[] }>
    >((acc, [tid, group]) => {
      acc[tid] = {
        fieldIds: Array.from(group.fieldIds),
        recordIds: Array.from(group.recordIds),
      };
      return acc;
    }, {});

    return { publishedOps: total, impact: resultImpact };
  }
}
