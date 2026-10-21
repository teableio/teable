/** Subset of the Sheets API v4 shapes this importer reads. */

export interface IGoogleSheetGridProperties {
  rowCount?: number;
  columnCount?: number;
}

export interface IGoogleSheetProperties {
  sheetId: number;
  title: string;
  /** GRID | OBJECT (chart) | DATA_SOURCE — only GRID tabs are importable. */
  sheetType?: string;
  gridProperties?: IGoogleSheetGridProperties;
}

export interface IGoogleSpreadsheetMeta {
  properties?: { title?: string };
  sheets?: { properties?: IGoogleSheetProperties }[];
}

/** One cell of an includeGridData response, trimmed by our fields mask. */
export interface IGoogleGridCell {
  formattedValue?: string;
  effectiveValue?: {
    stringValue?: string;
    numberValue?: number;
    boolValue?: boolean;
    errorValue?: { type?: string; message?: string };
  };
  effectiveFormat?: {
    numberFormat?: {
      /** TEXT | NUMBER | PERCENT | CURRENCY | DATE | TIME | DATE_TIME | SCIENTIFIC */
      type?: string;
    };
  };
}

export interface IGoogleGridSampleResponse {
  sheets?: {
    data?: {
      rowData?: { values?: IGoogleGridCell[] }[];
    }[];
  }[];
}

/** First-rows texts for many tabs at once, keyed back by each tab's sheetId. */
export interface IGoogleSampleRowsResponse {
  sheets?: {
    properties?: { sheetId?: number };
    data?: {
      rowData?: { values?: { formattedValue?: string }[] }[];
    }[];
  }[];
}

/** A values.get cell: JSON scalar under UNFORMATTED_VALUE rendering. */
export type IGoogleSheetCellValue = string | number | boolean;

export interface IGoogleValuesResponse {
  values?: IGoogleSheetCellValue[][];
}
