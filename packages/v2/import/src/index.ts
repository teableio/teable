// Ports (interfaces re-exported from core + registry implementation)
export * from './ports';

// Adapters (CSV, Excel implementations)
export * from './adapters';
export {
  prepareExcelImportSource,
  type PreparedExcelImportSource,
} from './adapters/excel/TemporaryWorkbook';

// DI
export * from './di';
