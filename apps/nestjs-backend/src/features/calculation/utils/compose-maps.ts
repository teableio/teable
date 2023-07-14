export function composeMaps<T>(opsMaps: ({ [x: string]: { [y: string]: T[] } } | undefined)[]): {
  [x: string]: { [y: string]: T[] };
} {
  return opsMaps
    .filter(Boolean)
    .reduce<{ [x: string]: { [y: string]: T[] } }>((composedMap, currentMap) => {
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
