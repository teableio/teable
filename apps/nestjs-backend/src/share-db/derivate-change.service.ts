import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable-group/db-main-prisma';
import { BatchService } from '../features/calculation/batch.service';
import { LinkService } from '../features/calculation/link.service';
import { ReferenceService } from '../features/calculation/reference.service';
import type { IOpsMap } from '../features/calculation/reference.service';
import type { ICellChange } from '../features/calculation/utils/changes';
import { formatChangesToOps } from '../features/calculation/utils/changes';
import { composeMaps } from '../features/calculation/utils/compose-maps';
import type { IRawOpMap } from './interface';

@Injectable()
export class DerivateChangeService {
  constructor(
    private readonly linkService: LinkService,
    private readonly prismaService: PrismaService,
    private readonly referenceService: ReferenceService,
    private readonly batchService: BatchService
  ) {}

  async derivateAndCalculateLink(
    src: string,
    changes: ICellChange[]
  ): Promise<IRawOpMap | undefined> {
    if (new Set(changes.map((c) => c.tableId)).size > 1) {
      throw new Error('Invalid changes, contains multiple tableId in 1 transaction');
    }

    if (changes.length) {
      return this.prismaService.$transaction(async () => {
        const opsMaps: IOpsMap[] = [];
        const derivate = await this.linkService.getDerivateByLink(changes[0].tableId, changes);
        const cellChanges = derivate?.cellChanges || [];
        const fkRecordMap = derivate?.fkRecordMap || {};

        const opsMapOrigin = formatChangesToOps(changes);
        const opsMapByLink = formatChangesToOps(cellChanges);
        const {
          opsMap: opsMapByCalculate,
          fieldMap,
          tableId2DbTableName,
        } = await this.referenceService.calculateOpsMap(
          composeMaps([opsMapOrigin, opsMapByLink]),
          fkRecordMap
        );
        opsMaps.push(opsMapByLink, opsMapByCalculate);
        const composedMap = composeMaps(opsMaps);
        return this.batchService.save(src, composedMap, fieldMap, tableId2DbTableName);
      });
    }
  }
}
