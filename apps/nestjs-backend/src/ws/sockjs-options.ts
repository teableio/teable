import deflate from 'permessage-deflate';
import type sockjs from 'sockjs';
import { instrumentDeflate } from './instrumented-deflate';

export type ISockjsLog = (severity: string, message: string) => void;

/**
 * permessage-deflate (RFC 7692) for the WebSocket transport.
 *
 * ShareDB pushes whole record snapshots down this socket (`share-db.adapter.ts`
 * hydrates query results via `getSnapshotBulk`), and SockJS then wraps each one
 * in `a["<json string>"]`, escaping the payload a second time. Repeated field
 * ids plus that escaping make the stream unusually compressible — measured
 * end to end in `sockjs-options.spec.ts` at 20.7x for a grid load (84 KB -> 4.1 KB
 * on the wire) and 12.9x for a burst of 300 record ops.
 *
 * Memory, not CPU, is the binding constraint here: every connection holds a
 * deflate and an inflate context for as long as it lives. Measured against 800
 * real connections, an uncompressed connection costs ~39 KiB and the settings
 * below bring a compressed one to ~250 KiB, down from ~398 KiB at zlib defaults
 * — with identical compression. Budget ~210 KiB per concurrent connection and
 * check `realtime.connections.active` for the peak before rolling out.
 *
 * - `level: 3` — measured no slower than level 1 on this data while compressing
 *   better (ops 19.9x vs 17.3x). Level 6 doubles grid CPU for +13%, level 9
 *   quadruples it. CPU is cheap either way: ~15 us per op, ~180 us per grid
 *   frame, so even 5k ops/sec is a few percent of one core.
 * - `maxWindowBits: 13` + `memLevel: 6` — bounds the deflate context, which is
 *   the dominant allocation (zlib needs `1<<(windowBits+2)` plus
 *   `1<<(memLevel+9)` bytes: 256 KiB at defaults, 64 KiB here). This is the
 *   memory/ratio trade and it is deliberately biased towards memory, because
 *   the deployment target is a 2 core / 4 GiB box. It is not free: on wide
 *   records the 8 KiB window gives up roughly a fifth of the ratio (a 2.3 MiB
 *   payload compresses 15.1x here against 19.1x at the 32 KiB default), while
 *   saving ~148 KiB per live connection. Revisit if peak
 *   `realtime.connections.active` per pod stays well under ~1500, where the
 *   wider window costs little memory and compresses better for the same CPU.
 *   Going narrower is a bad trade in both directions: wb12/mem5 drops ops to
 *   15.4x, wb11/mem4 drops grid loads to 19.1x.
 * - `requestMaxWindowBits: 13` — bounds the inflater, which is sized from the
 *   peer's window (`permessage-deflate/lib/session.js` `_getInflate`). Worth
 *   far less than the deflate side but free: inbound traffic is small ShareDB
 *   ops that lose nothing to an 8 KiB window.
 * - Context takeover stays enabled. Disabling it would bound memory further but
 *   collapses op compression from ~19.9x to ~1.4x, since each small message
 *   would restart from an empty dictionary.
 */
const permessageDeflate = instrumentDeflate(
  deflate.configure({
    level: 3,
    maxWindowBits: 13,
    memLevel: 6,
    requestMaxWindowBits: 13,
  })
);

export interface IRealtimeTransportConfig {
  /**
   * `SOCKJS_DISABLE_WEBSOCKET` — escape hatch for deployments whose proxy lets a
   * WebSocket open and then cuts it. `/socket/info` then advertises no
   * websocket, so clients go straight to xhr-streaming. That gives up the
   * permessage-deflate savings above and adds a POST per client message, so it
   * is off by default.
   */
  disableWebsocket: boolean;
  /**
   * `SOCKJS_IDLE_TIMEOUT_SECONDS` — close a session that has sent nothing for
   * this long; `0` turns it off. SockJS's own heartbeat only proves the hop
   * next to the server is alive: a proxy that answers the WebSocket ping itself
   * keeps a session whose browser left long ago, so those piled up without
   * bound. The SDK pings every 10s (`useConnection`), but Chrome fires timers
   * in a tab hidden for 5+ minutes only once a minute, and the SDK closes the
   * socket itself after 10 minutes away; the default leaves twice that minute.
   */
  idleTimeoutMs: number;
}

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 120;

export const resolveRealtimeTransportConfig = (
  env: Record<string, string | undefined> = process.env
): IRealtimeTransportConfig => {
  const disable = env.SOCKJS_DISABLE_WEBSOCKET?.trim().toLowerCase();
  const rawIdle = env.SOCKJS_IDLE_TIMEOUT_SECONDS?.trim();
  const idleSeconds = rawIdle ? Number(rawIdle) : NaN;
  return {
    disableWebsocket: disable === '1' || disable === 'true',
    idleTimeoutMs:
      Number.isFinite(idleSeconds) && idleSeconds >= 0
        ? Math.floor(idleSeconds * 1000)
        : DEFAULT_IDLE_TIMEOUT_SECONDS * 1000,
  };
};

/**
 * SockJS server configuration for collaborative data sync (similar to Airtable)
 * - transports: Only websocket and xhr-streaming (xhr-polling excluded for performance)
 * - response_limit: 2MB to handle large batch operations (table sync, bulk row updates)
 * - websocket: false when `SOCKJS_DISABLE_WEBSOCKET` is set (see IRealtimeTransportConfig)
 *
 * Note: compression applies to the websocket transport only. The xhr-streaming
 * fallback is unaffected — it would need HTTP-level compression instead.
 */
export const createSockjsServerOptions = (
  log: ISockjsLog,
  { disableWebsocket = false }: Partial<Pick<IRealtimeTransportConfig, 'disableWebsocket'>> = {}
) =>
  ({
    prefix: '/socket',
    transports: ['websocket', 'xhr-streaming'],
    websocket: !disableWebsocket,
    response_limit: 2 * 1024 * 1024, // 2MB for large collaborative payloads
    log,
    faye_server_options: { extensions: [permessageDeflate] },
    // eslint-disable-next-line @typescript-eslint/naming-convention
  }) as sockjs.ServerOptions & { transports: string[]; response_limit: number };
