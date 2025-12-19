import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { Field } from '../../../domain/table/fields/Field';
import { FieldId } from '../../../domain/table/fields/FieldId';
import { FieldName } from '../../../domain/table/fields/FieldName';
import { NumberField } from '../../../domain/table/fields/types/NumberField';
import { RatingField } from '../../../domain/table/fields/types/RatingField';
import { RatingMax } from '../../../domain/table/fields/types/RatingMax';
import { SelectOptionName } from '../../../domain/table/fields/types/SelectOptionName';
import { SingleLineTextField } from '../../../domain/table/fields/types/SingleLineTextField';
import { SingleSelectField } from '../../../domain/table/fields/types/SingleSelectField';
import type { IFieldVisitor } from '../../../domain/table/fields/visitors/IFieldVisitor';
import type { Table } from '../../../domain/table/Table';
import { Table as TableAggregate } from '../../../domain/table/Table';
import { TableId } from '../../../domain/table/TableId';
import { TableName } from '../../../domain/table/TableName';
import { BaseId } from '../../../domain/base/BaseId';
import { CalendarView } from '../../../domain/table/views/types/CalendarView';
import { FormView } from '../../../domain/table/views/types/FormView';
import { GalleryView } from '../../../domain/table/views/types/GalleryView';
import { GridView } from '../../../domain/table/views/types/GridView';
import { KanbanView } from '../../../domain/table/views/types/KanbanView';
import { PluginView } from '../../../domain/table/views/types/PluginView';
import type { View } from '../../../domain/table/views/View';
import { ViewId } from '../../../domain/table/views/ViewId';
import { ViewName } from '../../../domain/table/views/ViewName';
import type { IViewVisitor } from '../../../domain/table/views/visitors/IViewVisitor';
import type {
  ITableFieldPersistenceDTO,
  ITableMapper,
  ITablePersistenceDTO,
  ITableViewPersistenceDTO,
} from '../TableMapper';

const sequenceResults = <T>(
  values: ReadonlyArray<Result<T, string>>
): Result<ReadonlyArray<T>, string> =>
  values.reduce<Result<ReadonlyArray<T>, string>>(
    (acc, next) => acc.andThen((arr) => next.map((v) => [...arr, v])),
    ok([])
  );

class FieldToPersistenceVisitor implements IFieldVisitor<ITableFieldPersistenceDTO> {
  visitSingleLineTextField(field: SingleLineTextField): Result<ITableFieldPersistenceDTO, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'singleLineText',
    });
  }

  visitNumberField(field: NumberField): Result<ITableFieldPersistenceDTO, string> {
    return ok({ id: field.id().toString(), name: field.name().toString(), type: 'number' });
  }

  visitRatingField(field: RatingField): Result<ITableFieldPersistenceDTO, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'rating',
      max: field.ratingMax().toNumber(),
    });
  }

  visitSingleSelectField(field: SingleSelectField): Result<ITableFieldPersistenceDTO, string> {
    return ok({
      id: field.id().toString(),
      name: field.name().toString(),
      type: 'singleSelect',
      options: field.selectOptions().map((o) => o.toString()),
    });
  }
}

const mapFieldToDto = (field: Field): Result<ITableFieldPersistenceDTO, string> =>
  field.accept(new FieldToPersistenceVisitor());

class ViewToPersistenceVisitor implements IViewVisitor<ITableViewPersistenceDTO> {
  visitGridView(view: GridView): Result<ITableViewPersistenceDTO, string> {
    return ok({ id: view.id().toString(), name: view.name().toString(), type: 'grid' });
  }

  visitKanbanView(view: KanbanView): Result<ITableViewPersistenceDTO, string> {
    return ok({ id: view.id().toString(), name: view.name().toString(), type: 'kanban' });
  }

  visitGalleryView(view: GalleryView): Result<ITableViewPersistenceDTO, string> {
    return ok({ id: view.id().toString(), name: view.name().toString(), type: 'gallery' });
  }

  visitCalendarView(view: CalendarView): Result<ITableViewPersistenceDTO, string> {
    return ok({ id: view.id().toString(), name: view.name().toString(), type: 'calendar' });
  }

  visitFormView(view: FormView): Result<ITableViewPersistenceDTO, string> {
    return ok({ id: view.id().toString(), name: view.name().toString(), type: 'form' });
  }

  visitPluginView(view: PluginView): Result<ITableViewPersistenceDTO, string> {
    return ok({ id: view.id().toString(), name: view.name().toString(), type: 'plugin' });
  }
}

const mapViewToDto = (view: View): Result<ITableViewPersistenceDTO, string> =>
  view.accept(new ViewToPersistenceVisitor());

export class DefaultTableMapper implements ITableMapper {
  toDTO(table: Table): Result<ITablePersistenceDTO, string> {
    return sequenceResults(table.fields().map(mapFieldToDto)).andThen((fields) =>
      sequenceResults(table.views().map(mapViewToDto)).map((views) => ({
        id: table.id().toString(),
        baseId: table.baseId().toString(),
        name: table.name().toString(),
        primaryFieldId: table.primaryFieldId().toString(),
        fields: [...fields],
        views: [...views],
      }))
    );
  }

  toDomain(dto: ITablePersistenceDTO): Result<Table, string> {
    const idResult = TableId.create(dto.id);
    const baseIdResult = BaseId.create(dto.baseId);
    const nameResult = TableName.create(dto.name);
    const primaryFieldIdResult = FieldId.create(dto.primaryFieldId);

    const fieldsResult = sequenceResults(dto.fields.map((f) => this.mapFieldToDomain(f)));
    const viewsResult = sequenceResults(dto.views.map((v) => this.mapViewToDomain(v)));

    return idResult.andThen((id) =>
      baseIdResult.andThen((baseId) =>
        nameResult.andThen((name) =>
          primaryFieldIdResult.andThen((primaryFieldId) =>
            fieldsResult.andThen((fields) =>
              viewsResult.andThen((views) =>
                TableAggregate.rehydrate({ id, baseId, name, primaryFieldId, fields, views })
              )
            )
          )
        )
      )
    );
  }

  private mapFieldToDomain(dto: ITableFieldPersistenceDTO): Result<Field, string> {
    return FieldId.create(dto.id).andThen((id) =>
      FieldName.create(dto.name).andThen((name) => {
        switch (dto.type) {
          case 'singleLineText':
            return SingleLineTextField.create({ id, name });
          case 'number':
            return NumberField.create({ id, name });
          case 'rating':
            return RatingMax.create(dto.max).andThen((max) =>
              RatingField.create({ id, name, max })
            );
          case 'singleSelect':
            return sequenceResults(dto.options.map((o) => SelectOptionName.create(o))).andThen(
              (options) => SingleSelectField.create({ id, name, options })
            );
        }
      })
    );
  }

  private mapViewToDomain(dto: ITableViewPersistenceDTO): Result<View, string> {
    return ViewId.create(dto.id).andThen((id) =>
      ViewName.create(dto.name).andThen((name) => {
        switch (dto.type) {
          case 'grid':
            return GridView.create({ id, name });
          case 'kanban':
            return KanbanView.create({ id, name });
          case 'gallery':
            return GalleryView.create({ id, name });
          case 'calendar':
            return CalendarView.create({ id, name });
          case 'form':
            return FormView.create({ id, name });
          case 'plugin':
            return PluginView.create({ id, name });
        }
      })
    );
  }
}
