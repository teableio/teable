/**
 * DI tokens for command-explain module.
 */
export const v2CommandExplainTokens = {
  explainService: Symbol('v2.commandExplain.explainService'),
  sqlExplainRunner: Symbol('v2.commandExplain.sqlExplainRunner'),
  complexityCalculator: Symbol('v2.commandExplain.complexityCalculator'),
  updateRecordAnalyzer: Symbol('v2.commandExplain.updateRecordAnalyzer'),
  createRecordAnalyzer: Symbol('v2.commandExplain.createRecordAnalyzer'),
  deleteRecordsAnalyzer: Symbol('v2.commandExplain.deleteRecordsAnalyzer'),
  pasteCommandAnalyzer: Symbol('v2.commandExplain.pasteCommandAnalyzer'),
} as const;
