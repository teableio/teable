export type IAggregationFunctionHandler = () => string;

export interface IAggregationFunctionInterface {
  count: IAggregationFunctionHandler;
  empty: IAggregationFunctionHandler;
  filled: IAggregationFunctionHandler;
  unique: IAggregationFunctionHandler;
  max: IAggregationFunctionHandler;
  min: IAggregationFunctionHandler;
  sum: IAggregationFunctionHandler;
  average: IAggregationFunctionHandler;
  checked: IAggregationFunctionHandler;
  unChecked: IAggregationFunctionHandler;
  percentEmpty: IAggregationFunctionHandler;
  percentFilled: IAggregationFunctionHandler;
  percentUnique: IAggregationFunctionHandler;
  percentChecked: IAggregationFunctionHandler;
  percentUnChecked: IAggregationFunctionHandler;
  earliestDate: IAggregationFunctionHandler;
  latestDate: IAggregationFunctionHandler;
  dateRangeOfDays: IAggregationFunctionHandler;
  dateRangeOfMonths: IAggregationFunctionHandler;
  totalAttachmentSize: IAggregationFunctionHandler;
}
