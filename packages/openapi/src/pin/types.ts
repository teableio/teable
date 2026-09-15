import { ResourceType } from '../types';

export enum PinType {
  Space = ResourceType.Space,
  Base = ResourceType.Base,
  Table = ResourceType.Table,
  View = ResourceType.View,
  Dashboard = ResourceType.Dashboard,
  Workflow = ResourceType.Workflow,
  App = ResourceType.App,
  Routine = ResourceType.Routine,
  /**
   * AI chat threads. Stored in the same pin table as the other types, but surfaced by the
   * chat history endpoint (pinned chats float to the top of the list) rather than the
   * space sidebar's pin list.
   */
  Chat = 'chat',
}
