import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { NumberField } from '../types/NumberField';
import type { RatingField } from '../types/RatingField';
import type { SingleSelectField } from '../types/SingleSelectField';
import type { SingleLineTextField } from '../types/SingleLineTextField';
import type { IFieldVisitor } from './IFieldVisitor';

export class NoopFieldVisitor implements IFieldVisitor {
  visitSingleLineTextField(_: SingleLineTextField): Result<void, string> {
    return ok(undefined);
  }

  visitNumberField(_: NumberField): Result<void, string> {
    return ok(undefined);
  }

  visitRatingField(_: RatingField): Result<void, string> {
    return ok(undefined);
  }

  visitSingleSelectField(_: SingleSelectField): Result<void, string> {
    return ok(undefined);
  }
}
