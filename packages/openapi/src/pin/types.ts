import { ResourceType } from '../types';

export enum PinType {
  Space = ResourceType.Space,
  Base = ResourceType.Base,
  Table = ResourceType.Table,
  View = ResourceType.View,
  Dashboard = ResourceType.Dashboard,
  Workflow = ResourceType.Workflow,
  App = ResourceType.App,
}
