import type { WebSocket } from 'ws';

export interface IWebSocketWithAgentId extends WebSocket {
  agentId?: string;
}
