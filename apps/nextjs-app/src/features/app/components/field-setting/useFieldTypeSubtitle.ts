import { assertNever, FieldType } from '@teable-group/core';
import { useCallback } from 'react';

export const useFieldTypeSubtitle = () => {
  return useCallback((fieldType: FieldType | 'lookup'): string => {
    switch (fieldType) {
      case 'lookup':
        return 'See values from a field in a linked record.';
      case FieldType.Link:
        return 'Link to records in the table you choose';
      case FieldType.SingleLineText:
        return 'Enter text, or prefill each new cell with a default value.';
      case FieldType.LongText:
        return 'Enter multiple lines of text.';
      case FieldType.Attachment:
        return 'Add images, documents, or other files to be viewed or downloaded.';
      case FieldType.Checkbox:
        return 'Check or uncheck to indicate status.';
      case FieldType.MultipleSelect:
        return 'Select one or more predefined options in a list.';
      case FieldType.SingleSelect:
        return 'Select one predefined option from a list, or prefill each new cell with a default option.';
      case FieldType.User:
        return 'Add an user to a record.';
      case FieldType.Date:
        return 'Enter a date (e.g. 11/12/2023) or choose one from a calendar.';
      case FieldType.PhoneNumber:
        return 'Enter a telephone number (e.g. (415) 555-0000).';
      case FieldType.Email:
        return 'Enter an email address (e.g. bieber@example.com).';
      case FieldType.URL:
        return 'Enter a URL (e.g. teable.io or https://github.com/teableio).';
      case FieldType.Number:
        return 'Enter a number, or prefill each new cell with a default value.';
      case FieldType.Currency:
        return 'Enter a monetary amount, or prefill each new cell with a default value.';
      case FieldType.Percent:
        return 'Enter a percentage, or prefill each new cell with a default value.';
      case FieldType.Duration:
        return 'Enter a duration of time in hours, minutes or seconds (e.g. 1:23).';
      case FieldType.Rating:
        return 'Add a rating on a predefined scale.';
      case FieldType.Formula:
        return 'Compute values based on fields.';
      case FieldType.Rollup:
        return 'Summarize data from linked records.';
      case FieldType.Count:
        return 'Count the number of linked records.';
      case FieldType.CreatedTime:
        return 'See the date and time each record was created.';
      case FieldType.LastModifiedTime:
        return 'See the date and time of the most recent edit to some or all fields in a record.';
      case FieldType.CreatedBy:
        return 'See which user created the record.';
      case FieldType.LastModifiedBy:
        return 'See which user made the most recent edit to some or all fields in a record.';
      case FieldType.AutoNumber:
        return 'Automatically generate unique incremental numbers for each record.';
      case FieldType.Button:
        return 'Trigger a customized action.';
      default: {
        assertNever(fieldType);
      }
    }
  }, []);
};
