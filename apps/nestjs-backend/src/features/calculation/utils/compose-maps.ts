import sharedb from 'sharedb';

export function composeMaps<T extends { p: (string | number)[] }>(
  opsMaps: ({ [x: string]: { [y: string]: T[] } } | undefined)[]
): {
  [x: string]: { [y: string]: T[] };
} {
  return (opsMaps as { [x: string]: { [y: string]: T[] } }[])
    .filter(Boolean)
    .reduce<{ [x: string]: { [y: string]: T[] } }>((composedMap, currentMap) => {
      Object.keys(currentMap).forEach((tableId) => {
        composedMap[tableId] = composedMap[tableId] || {};

        Object.keys(currentMap[tableId]).forEach((recordId) => {
          composedMap[tableId][recordId] = composedMap[tableId][recordId] || [];

          const opIndexObj: Record<string, number> = {};
          composedMap[tableId][recordId].forEach((op, index) => {
            opIndexObj[op.p.join()] = index;
          });

          currentMap[tableId][recordId].forEach((op) => {
            const opKey = op.p.join();
            const existingOpIndex = opIndexObj[opKey];
            if (existingOpIndex !== undefined) {
              const oldOp = composedMap[tableId][recordId][existingOpIndex];
              composedMap[tableId][recordId][existingOpIndex] = sharedb.types.map['json0'].compose(
                op,
                oldOp
              );
            } else {
              opIndexObj[opKey] = composedMap[tableId][recordId].length;
              composedMap[tableId][recordId].push(op);
            }
          });
        });
      });
      return composedMap;
    }, {});
}
