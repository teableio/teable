/* eslint-disable @typescript-eslint/no-explicit-any */
import { faker } from '@faker-js/faker';
import type {
  CellArray,
  DataEditorProps,
  EditableGridCell,
  GridCell,
  GridColumn,
  Item,
  Rectangle,
} from '@glideapps/glide-data-grid';
import {
  GridCellKind,
  GridColumnIcon,
  isEditableGridCell,
  isTextEditableGridCell,
} from '@glideapps/glide-data-grid';

import isArray from 'lodash/isArray.js';
import * as React from 'react';

faker.seed(1337);

function isTruthy(x: any): boolean {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  return x ? true : false;
}

/**
 * Attempts to copy data between grid cells of any kind.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function lossyCopyData<T extends EditableGridCell>(
  source: EditableGridCell,
  target: T
): EditableGridCell {
  const sourceData = source.data;
  if (typeof sourceData === typeof target.data) {
    return {
      ...target,
      data: sourceData as any,
    };
  } else
    switch (target.kind) {
      case GridCellKind.Uri: {
        if (isArray(sourceData)) {
          return {
            ...target,
            data: sourceData[0],
          };
        }
        return {
          ...target,
          data: sourceData?.toString() ?? '',
        };
      }
      case GridCellKind.Boolean: {
        if (isArray(sourceData)) {
          return {
            ...target,
            data: sourceData[0] !== undefined,
          };
        } else if (source.kind === GridCellKind.Boolean) {
          return {
            ...target,
            data: source.data,
          };
        }
        return {
          ...target,
          data: isTruthy(sourceData) ? true : false,
        };
      }
      case GridCellKind.Image: {
        if (isArray(sourceData)) {
          return {
            ...target,
            data: [sourceData[0]],
          };
        }
        return {
          ...target,
          data: [sourceData?.toString() ?? ''],
        };
      }
      case GridCellKind.Number: {
        return {
          ...target,
          data: 0,
        };
      }
      case GridCellKind.Text:
      case GridCellKind.Markdown: {
        if (isArray(sourceData)) {
          return {
            ...target,
            data: sourceData[0].toString() ?? '',
          };
        }

        return {
          ...target,
          data: source.data?.toString() ?? '',
        };
      }
      case GridCellKind.Custom: {
        return target;
      }
      // No default
    }
  assertNever(target);
}

export type GridColumnWithMockingInfo = GridColumn & {
  getContent(): GridCell;
};

export function getGridColumn(
  columnWithMock: GridColumnWithMockingInfo
): GridColumn {
  const { getContent, ...rest } = columnWithMock;

  return rest;
}

function getResizableColumns(
  amount: number,
  group: boolean
): GridColumnWithMockingInfo[] {
  const defaultColumns: GridColumnWithMockingInfo[] = [
    {
      title: 'First name',
      id: 'First name',
      group: group ? 'Name' : undefined,
      icon: GridColumnIcon.HeaderString,
      hasMenu: false,
      getContent: () => {
        const firstName = faker.name.firstName();
        return {
          kind: GridCellKind.Text,
          displayData: firstName,
          data: firstName,
          allowOverlay: true,
          readonly: true,
        };
      },
    },
    {
      title: 'Last name',
      id: 'Last name',
      group: group ? 'Name' : undefined,
      icon: GridColumnIcon.HeaderString,
      hasMenu: false,
      getContent: () => {
        const lastName = faker.name.lastName();
        return {
          kind: GridCellKind.Text,
          displayData: lastName,
          data: lastName,
          allowOverlay: true,
          readonly: true,
        };
      },
    },
    {
      title: 'Avatar',
      id: 'Avatar',
      group: group ? 'Info' : undefined,
      icon: GridColumnIcon.HeaderImage,
      hasMenu: false,
      getContent: () => {
        const n = Math.round(Math.random() * 100);
        return {
          kind: GridCellKind.Image,
          data: [`https://picsum.photos/id/${n}/900/900`],
          displayData: [`https://picsum.photos/id/${n}/40/40`],
          allowOverlay: true,
          allowAdd: false,
          readonly: true,
        };
      },
    },
    {
      title: 'Email',
      id: 'Email',
      group: group ? 'Info' : undefined,
      icon: GridColumnIcon.HeaderString,
      hasMenu: false,
      getContent: () => {
        const email = faker.internet.email();
        return {
          kind: GridCellKind.Text,
          displayData: email,
          data: email,
          allowOverlay: true,
          readonly: true,
        };
      },
    },
    {
      title: 'Title',
      id: 'Title',
      group: group ? 'Info' : undefined,
      icon: GridColumnIcon.HeaderString,
      hasMenu: false,
      getContent: () => {
        const company = faker.name.jobTitle();
        return {
          kind: GridCellKind.Text,
          displayData: company,
          data: company,
          allowOverlay: true,
          readonly: true,
        };
      },
    },
    {
      title: 'More Info',
      id: 'More Info',
      group: group ? 'Info' : undefined,
      icon: GridColumnIcon.HeaderUri,
      hasMenu: false,
      getContent: () => {
        const url = faker.internet.url();
        return {
          kind: GridCellKind.Uri,
          displayData: url,
          data: url,
          allowOverlay: true,
          readonly: true,
        };
      },
    },
  ];

  if (amount < defaultColumns.length) {
    return defaultColumns.slice(0, amount);
  }

  const extraColumnsAmount = amount - defaultColumns.length;

  const extraColumns = [...new Array(extraColumnsAmount)].map((_, index) =>
    createTextColumnInfo(index + defaultColumns.length, group)
  );

  return [...defaultColumns, ...extraColumns];
}

function createTextColumnInfo(
  index: number,
  group: boolean
): GridColumnWithMockingInfo {
  return {
    title: `Column ${index}`,
    id: `Column ${index}`,
    group: group ? `Group ${Math.round(index / 3)}` : undefined,
    icon: GridColumnIcon.HeaderString,
    hasMenu: false,
    getContent: () => {
      const text = faker.lorem.word();

      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: true,
        readonly: true,
      };
    },
  };
}

export class ContentCache {
  // column -> row -> value
  private cachedContent: Map<number, Map<number, GridCell>> = new Map();

  get(col: number, row: number) {
    const colCache = this.cachedContent.get(col);

    if (colCache === undefined) {
      return undefined;
    }

    return colCache.get(row);
  }

  set(col: number, row: number, value: GridCell) {
    if (this.cachedContent.get(col) === undefined) {
      this.cachedContent.set(col, new Map());
    }

    const rowCache = this.cachedContent.get(col) as Map<number, GridCell>;
    rowCache.set(row, value);
  }
}

export const defaultProps: Partial<DataEditorProps> = {
  smoothScrollX: true,
  smoothScrollY: true,
  getCellsForSelection: true,
  width: '100%',
};

export function clearCell(cell: GridCell): GridCell {
  switch (cell.kind) {
    case GridCellKind.Boolean: {
      return {
        ...cell,
        data: false,
      };
    }
    case GridCellKind.Image: {
      return {
        ...cell,
        data: [],
        displayData: [],
      };
    }
    case GridCellKind.Drilldown:
    case GridCellKind.Bubble: {
      return {
        ...cell,
        data: [],
      };
    }
    case GridCellKind.Uri:
    case GridCellKind.Markdown: {
      return {
        ...cell,
        data: '',
      };
    }
    case GridCellKind.Text: {
      return {
        ...cell,
        data: '',
        displayData: '',
      };
    }
    case GridCellKind.Number: {
      return {
        ...cell,
        data: 0,
        displayData: '',
      };
    }
  }
  return cell;
}

export function useMockDataGenerator(
  numCols: number,
  readonly = true,
  group = false
) {
  const cache = React.useRef<ContentCache>(new ContentCache());

  const [colsMap, setColsMap] = React.useState(() =>
    getResizableColumns(numCols, group)
  );

  React.useEffect(() => {
    setColsMap(getResizableColumns(numCols, group));
  }, [group, numCols]);

  const onColumnResize = React.useCallback(
    (column: GridColumn, newSize: number) => {
      setColsMap((prevColsMap) => {
        const index = prevColsMap.findIndex((ci) => ci.title === column.title);
        const newArray = [...prevColsMap];
        newArray.splice(index, 1, {
          ...prevColsMap[index],
          width: newSize,
        });
        return newArray;
      });
    },
    []
  );

  const cols = React.useMemo(() => {
    return colsMap.map(getGridColumn);
  }, [colsMap]);

  const colsMapRef = React.useRef(colsMap);
  colsMapRef.current = colsMap;
  const getCellContent = React.useCallback(
    ([col, row]: Item): GridCell => {
      let val = cache.current.get(col, row);
      if (val === undefined) {
        val = colsMapRef.current[col].getContent();
        if (!readonly && isTextEditableGridCell(val)) {
          val = { ...val, readonly };
        }
        cache.current.set(col, row, val);
      }
      return val;
    },
    [readonly]
  );

  const getCellsForSelection = React.useCallback(
    (selection: Rectangle): CellArray => {
      const result: GridCell[][] = [];

      for (let y = selection.y; y < selection.y + selection.height; y++) {
        const row: GridCell[] = [];
        for (let x = selection.x; x < selection.x + selection.width; x++) {
          row.push(getCellContent([x, y]));
        }
        result.push(row);
      }

      return result;
    },
    [getCellContent]
  );

  const setCellValueRaw = React.useCallback(
    ([col, row]: Item, val: GridCell): void => {
      cache.current.set(col, row, val);
    },
    []
  );

  const setCellValue = React.useCallback(
    ([col, row]: Item, val: GridCell): void => {
      let current = cache.current.get(col, row);
      if (current === undefined) {
        current = colsMap[col].getContent();
      }
      if (isEditableGridCell(val) && isEditableGridCell(current)) {
        const copied = lossyCopyData(val, current);
        cache.current.set(col, row, {
          ...copied,
          displayData:
            typeof copied.data === 'string'
              ? copied.data
              : (copied as any).displayData,
          lastUpdated: performance.now(),
        } as any);
      }
    },
    [colsMap]
  );

  return {
    cols,
    getCellContent,
    onColumnResize,
    setCellValue,
    getCellsForSelection,
    setCellValueRaw,
  };
}

function panic(message = 'This should not happen'): never {
  throw new Error(message);
}

export function assertNever(_never: never): never {
  return panic('Hell froze over');
}
