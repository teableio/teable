import type { Result } from 'neverthrow';

import type { Table } from '../../domain/table/Table';

export type ITableFieldPersistenceDTO =
  | { id: string; name: string; type: 'singleLineText' }
  | { id: string; name: string; type: 'longText' }
  | { id: string; name: string; type: 'number' }
  | { id: string; name: string; type: 'rating'; max: number }
  | { id: string; name: string; type: 'singleSelect'; options: ReadonlyArray<string> }
  | { id: string; name: string; type: 'multipleSelect'; options: ReadonlyArray<string> }
  | { id: string; name: string; type: 'checkbox' }
  | { id: string; name: string; type: 'attachment' }
  | { id: string; name: string; type: 'date' }
  | { id: string; name: string; type: 'user' }
  | { id: string; name: string; type: 'button' };

export type ITableViewPersistenceDTO =
  | { id: string; name: string; type: 'grid' }
  | { id: string; name: string; type: 'calendar' }
  | { id: string; name: string; type: 'kanban' }
  | { id: string; name: string; type: 'form' }
  | { id: string; name: string; type: 'gallery' }
  | { id: string; name: string; type: 'plugin' };

export type ITablePersistenceDTO = {
  id: string;
  baseId: string;
  name: string;
  primaryFieldId: string;
  fields: ReadonlyArray<ITableFieldPersistenceDTO>;
  views: ReadonlyArray<ITableViewPersistenceDTO>;
};

export interface ITableMapper {
  toDTO(table: Table): Result<ITablePersistenceDTO, string>;
  toDomain(dto: ITablePersistenceDTO): Result<Table, string>;
}
