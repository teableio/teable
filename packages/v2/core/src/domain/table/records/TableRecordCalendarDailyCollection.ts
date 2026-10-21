import type { FieldId } from '../fields/FieldId';
import type { TimeZone } from '../fields/types/TimeZone';

export class TableRecordCalendarDailyCollection {
  private constructor(
    readonly startFieldId: FieldId,
    readonly endFieldId: FieldId,
    readonly timeZone: TimeZone
  ) {}

  static create(params: {
    startFieldId: FieldId;
    endFieldId: FieldId;
    timeZone: TimeZone;
  }): TableRecordCalendarDailyCollection {
    return new TableRecordCalendarDailyCollection(
      params.startFieldId,
      params.endFieldId,
      params.timeZone
    );
  }
}
