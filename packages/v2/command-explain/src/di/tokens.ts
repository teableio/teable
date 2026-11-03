/**
 * DI tokens for command-explain module.
 */
export const v2CommandExplainTokens = {
  explainService: Symbol('v2.commandExplain.explainService'),
  complexityService: Symbol('v2.commandExplain.complexityService'),
  previewPlannerRegistry: Symbol('v2.commandExplain.previewPlannerRegistry'),
  operationPreviewService: Symbol('v2.commandExplain.operationPreviewService'),
  sqlExplainRunner: Symbol('v2.commandExplain.sqlExplainRunner'),
  complexityCalculator: Symbol('v2.commandExplain.complexityCalculator'),
  createFieldAnalyzer: Symbol('v2.commandExplain.createFieldAnalyzer'),
  updateFieldAnalyzer: Symbol('v2.commandExplain.updateFieldAnalyzer'),
  deleteFieldAnalyzer: Symbol('v2.commandExplain.deleteFieldAnalyzer'),
  deleteTableAnalyzer: Symbol('v2.commandExplain.deleteTableAnalyzer'),
  updateRecordAnalyzer: Symbol('v2.commandExplain.updateRecordAnalyzer'),
  createRecordAnalyzer: Symbol('v2.commandExplain.createRecordAnalyzer'),
  deleteRecordsAnalyzer: Symbol('v2.commandExplain.deleteRecordsAnalyzer'),
  pasteCommandAnalyzer: Symbol('v2.commandExplain.pasteCommandAnalyzer'),
} as const;
