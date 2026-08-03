/* eslint-disable @typescript-eslint/no-explicit-any */
import { CellValueType, FieldType } from '../field';
import { getValidStatisticFunc } from './statistic';
import { StatisticsFunc } from './statistics-func.enum';

describe('getValidStatisticFunc', () => {
  it('should return an empty array if no field is provided', () => {
    const result = getValidStatisticFunc();
    expect(result).toEqual([]);
  });

  it('should return the correct statistics functions for a link field', () => {
    const field: any = {
      cellValueType: CellValueType.String,
      type: FieldType.Link,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ]);
  });

  it('should return the correct statistics functions for a user/createdBy/lastModifiedBy field', () => {
    const field: any = {
      type: FieldType.User,
      isMultipleCellValue: false,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.Unique,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentUnique,
    ]);
  });

  it('should return the correct statistics functions for a user/createdBy/lastModifiedBy field with multipleCellValue', () => {
    const field: any = {
      type: FieldType.User,
      isMultipleCellValue: true,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
    ]);
  });

  it('should return the correct statistics functions for a string field', () => {
    const field: any = {
      cellValueType: CellValueType.String,
      type: FieldType.SingleLineText,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.Unique,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentUnique,
    ]);
  });

  it('should return the correct statistics functions for a number field', () => {
    const field: any = {
      cellValueType: CellValueType.Number,
      type: FieldType.Number,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Sum,
      StatisticsFunc.Average,
      StatisticsFunc.Min,
      StatisticsFunc.Max,
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.Unique,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentUnique,
    ]);
  });

  it('should return the correct statistics functions for a dateTime field', () => {
    const field: any = {
      cellValueType: CellValueType.DateTime,
      type: FieldType.Date,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.Unique,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.PercentUnique,
      StatisticsFunc.EarliestDate,
      StatisticsFunc.LatestDate,
      StatisticsFunc.DateRangeOfDays,
      StatisticsFunc.DateRangeOfMonths,
    ]);
  });

  it('should return the correct statistics functions for a boolean field', () => {
    const field: any = {
      cellValueType: CellValueType.Boolean,
      type: FieldType.Checkbox,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Checked,
      StatisticsFunc.UnChecked,
      StatisticsFunc.PercentChecked,
      StatisticsFunc.PercentUnChecked,
    ]);
  });

  it('should include TotalAttachmentSize statistics function for an attachment field', () => {
    const field: any = {
      cellValueType: CellValueType.String,
      type: FieldType.Attachment,
    };
    const result = getValidStatisticFunc(field);
    expect(result).toEqual([
      StatisticsFunc.Count,
      StatisticsFunc.Empty,
      StatisticsFunc.Filled,
      StatisticsFunc.PercentEmpty,
      StatisticsFunc.PercentFilled,
      StatisticsFunc.TotalAttachmentSize,
    ]);
  });
});
