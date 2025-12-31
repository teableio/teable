import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../../shared/DomainError';
import { ValueObject } from '../../../shared/ValueObject';
import { FieldColor, type FieldColorValue } from './FieldColor';
import { SelectOptionId } from './SelectOptionId';
import { SelectOptionName } from './SelectOptionName';

const selectOptionSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  color: z.string(),
});

export class SelectOption extends ValueObject {
  private constructor(
    private readonly idValue: SelectOptionId,
    private readonly nameValue: SelectOptionName,
    private readonly colorValue: FieldColor
  ) {
    super();
  }

  static create(raw: unknown): Result<SelectOption, DomainError> {
    const parsed = selectOptionSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid SelectOption' }));

    return SelectOptionName.create(parsed.data.name).andThen((name) => {
      const idResult = parsed.data.id
        ? SelectOptionId.create(parsed.data.id)
        : SelectOptionId.generate();
      return idResult.andThen((id) =>
        FieldColor.create(parsed.data.color).map((color) => new SelectOption(id, name, color))
      );
    });
  }

  equals(other: SelectOption): boolean {
    return (
      this.idValue.equals(other.idValue) &&
      this.nameValue.equals(other.nameValue) &&
      this.colorValue.equals(other.colorValue)
    );
  }

  id(): SelectOptionId {
    return this.idValue;
  }

  name(): SelectOptionName {
    return this.nameValue;
  }

  color(): FieldColor {
    return this.colorValue;
  }

  toDto(): { id: string; name: string; color: FieldColorValue } {
    return {
      id: this.idValue.toString(),
      name: this.nameValue.toString(),
      color: this.colorValue.toString(),
    };
  }
}
