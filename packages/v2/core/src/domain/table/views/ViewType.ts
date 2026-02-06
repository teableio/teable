import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { domainError, type DomainError } from '../../shared/DomainError';
import { ValueObject } from '../../shared/ValueObject';

const viewTypeSchema = z.enum(['grid', 'calendar', 'kanban', 'form', 'gallery', 'plugin']);
export type IViewTypeLiteral = z.infer<typeof viewTypeSchema>;

export class ViewType extends ValueObject {
  private constructor(private readonly value: IViewTypeLiteral) {
    super();
  }

  static create(raw: unknown): Result<ViewType, DomainError> {
    const parsed = viewTypeSchema.safeParse(raw);
    if (!parsed.success) return err(domainError.validation({ message: 'Invalid ViewType' }));
    return ok(new ViewType(parsed.data));
  }

  static grid(): ViewType {
    return new ViewType('grid');
  }

  static calendar(): ViewType {
    return new ViewType('calendar');
  }

  static kanban(): ViewType {
    return new ViewType('kanban');
  }

  static form(): ViewType {
    return new ViewType('form');
  }

  static gallery(): ViewType {
    return new ViewType('gallery');
  }

  static plugin(): ViewType {
    return new ViewType('plugin');
  }

  equals(other: ViewType): boolean {
    return this.value === other.value;
  }

  toString(): IViewTypeLiteral {
    return this.value;
  }
}
