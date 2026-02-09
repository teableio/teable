import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { TimeZone, type TimeZoneValue } from './TimeZone';

export const DateFormattingPreset = {
  US: 'M/D/YYYY',
  European: 'D/M/YYYY',
  Asian: 'YYYY/MM/DD',
  ISO: 'YYYY-MM-DD',
  YM: 'YYYY-MM',
  MD: 'MM-DD',
  Y: 'YYYY',
  M: 'MM',
  D: 'DD',
} as const;

export type DateFormattingPreset = (typeof DateFormattingPreset)[keyof typeof DateFormattingPreset];

export const TimeFormatting = {
  Hour24: 'HH:mm',
  Hour12: 'hh:mm A',
  None: 'None',
} as const;

export type TimeFormatting = (typeof TimeFormatting)[keyof typeof TimeFormatting];

const dateTimeFormattingSchema = z.object({
  date: z.string(),
  time: z.enum([TimeFormatting.Hour24, TimeFormatting.Hour12, TimeFormatting.None]),
  timeZone: z.string(),
});

export type DateTimeFormattingValue = {
  date: string;
  time: TimeFormatting;
  timeZone: TimeZoneValue;
};

export class DateTimeFormatting extends ValueObject {
  private constructor(
    private readonly dateValue: string,
    private readonly timeValue: TimeFormatting,
    private readonly timeZoneValue: TimeZone
  ) {
    super();
  }

  static create(raw: unknown): Result<DateTimeFormatting, DomainError> {
    const parsed = dateTimeFormattingSchema.safeParse(raw);
    if (!parsed.success)
      return err(domainError.validation({ message: 'Invalid DateTimeFormatting' }));

    return TimeZone.create(parsed.data.timeZone).map(
      (timeZone) => new DateTimeFormatting(parsed.data.date, parsed.data.time, timeZone)
    );
  }

  static default(): DateTimeFormatting {
    return new DateTimeFormatting(
      DateFormattingPreset.ISO,
      TimeFormatting.None,
      TimeZone.default()
    );
  }

  equals(other: DateTimeFormatting): boolean {
    return (
      this.dateValue === other.dateValue &&
      this.timeValue === other.timeValue &&
      this.timeZoneValue.equals(other.timeZoneValue)
    );
  }

  date(): string {
    return this.dateValue;
  }

  time(): TimeFormatting {
    return this.timeValue;
  }

  timeZone(): TimeZone {
    return this.timeZoneValue;
  }

  toDto(): DateTimeFormattingValue {
    return {
      date: this.dateValue,
      time: this.timeValue,
      timeZone: this.timeZoneValue.toString(),
    };
  }
}
