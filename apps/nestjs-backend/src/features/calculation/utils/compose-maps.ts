import type { IOtOperation } from '@teable/core';
import { isEmpty, isEqual } from 'lodash';
export interface IOpsMap {
  [tableId: string]: {
    [keyId: string]: IOtOperation[];
  };
}

export function composeOpMaps(opsMaps: (IOpsMap | undefined)[]): IOpsMap {
  return (opsMaps as IOpsMap[]).filter(Boolean).reduce<IOpsMap>((composedMap, currentMap) => {
    Object.keys(currentMap).forEach((tableId) => {
      composedMap[tableId] = composedMap[tableId] || {};

      Object.keys(currentMap[tableId]).forEach((recordId) => {
        composedMap[tableId][recordId] = composedMap[tableId][recordId] || [];

        const opIndexObj: Record<string, number> = {};

        // indexing
        composedMap[tableId][recordId].forEach((op, index) => {
          opIndexObj[op.p.join()] = index;
        });

        // compose op that has same path
        currentMap[tableId][recordId].forEach((op) => {
          const opKey = op.p.join();
          const existingOpIndex = opIndexObj[opKey];
          if (existingOpIndex !== undefined) {
            const oldOp = composedMap[tableId][recordId][existingOpIndex];
            composedMap[tableId][recordId][existingOpIndex] = {
              p: op.p,
              od: oldOp.od,
              oi: op.oi,
            };
          } else {
            opIndexObj[opKey] = composedMap[tableId][recordId].length;
            composedMap[tableId][recordId].push(op);
          }
        });

        // filter op that has same oi and od
        composedMap[tableId][recordId] = composedMap[tableId][recordId].filter(
          (op) => !isEqual(op.oi, op.od)
        );

        if (!composedMap[tableId][recordId].length) {
          delete composedMap[tableId][recordId];
        }
      });

      if (isEmpty(composedMap[tableId])) {
        delete composedMap[tableId];
      }
    });
    return composedMap;
  }, {});
}
