import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../../shared/DomainError';
import { View } from '../View';
import type { ViewId } from '../ViewId';
import type { ViewName } from '../ViewName';
import { ViewType } from '../ViewType';
import type { IViewVisitor } from '../visitors/IViewVisitor';

export class CalendarView extends View {
  private constructor(id: ViewId, name: ViewName) {
    super(id, name, ViewType.calendar());
  }

  static create(params: { id: ViewId; name: ViewName }): Result<CalendarView, DomainError> {
    return ok(new CalendarView(params.id, params.name));
  }

  accept<T = void>(visitor: IViewVisitor<T>): Result<T, DomainError> {
    return visitor.visitCalendarView(this);
  }
}
