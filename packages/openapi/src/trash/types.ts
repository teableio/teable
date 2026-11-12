import { ResourceType } from '../types';

export enum TrashType {
  Space = ResourceType.Space,
  Base = ResourceType.Base,
  Table = ResourceType.Table,
  App = ResourceType.App,
  Workflow = ResourceType.Workflow,
  Routine = ResourceType.Routine,
  Folder = ResourceType.Folder,
  Dashboard = ResourceType.Dashboard,
}

export enum TableTrashType {
  View = ResourceType.View,
  Field = ResourceType.Field,
  Record = ResourceType.Record,
}
