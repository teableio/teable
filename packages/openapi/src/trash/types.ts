import { ResourceType } from '../types';

export enum TrashType {
  Space = ResourceType.Space,
  Base = ResourceType.Base,
  Table = ResourceType.Table,
  App = ResourceType.App,
  Workflow = ResourceType.Workflow,
  Routine = ResourceType.Routine,
}

export enum TableTrashType {
  View = ResourceType.View,
  Field = ResourceType.Field,
  Record = ResourceType.Record,
}
