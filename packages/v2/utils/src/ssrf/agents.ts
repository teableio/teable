/* eslint-disable @typescript-eslint/naming-convention */
import dns from 'node:dns';
import { isIP, type LookupFunction, type TcpNetConnectOpts } from 'node:net';
import type { Duplex } from 'node:stream';
import ipaddr from 'ipaddr.js';
import { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } from 'request-filtering-agent';
import { isSsrfProtectionDisabled } from './fetch';

/**
 * SSRF guards for the `http.Agent` transport stack (axios / node-fetch), the
 * counterpart to `ssrf-fetch.ts`'s undici dispatcher. Both live here so all SSRF
 * primitives share one home; pick the helper that matches your client's agent
 * shape. node-only (`request-filtering-agent` wraps Node's http/https agents).
 */

// Both agents are always returned to prevent redirect-based SSRF bypass
// (e.g., http://evil.com redirects to https://169.254.169.254). keepAlive keeps
// warm sockets for repeated hits on the same host (presigned storage URLs); the
// filtering hook runs at createConnection, unaffected by socket reuse.
const EMPTY_AGENTS = {};
const SAFE_AGENTS = {
  httpAgent: new RequestFilteringHttpAgent({ keepAlive: true }),
  httpsAgent: new RequestFilteringHttpsAgent({ keepAlive: true }),
};
// Cloud instance-metadata endpoints a private-network peer may still never reach:
// IMDS on AWS / GCP / Azure (169.254.169.254, whole link-local range), AWS IMDS over
// IPv6 (fd00:ec2::254) and Alibaba Cloud (100.100.100.200).
const CLOUD_METADATA_RANGES = [
  '169.254.0.0/16',
  'fe80::/10',
  'fd00:ec2::254/128',
  '100.100.100.200/32',
].map((cidr) => ipaddr.parseCIDR(cidr));

/** Fails closed on unparseable input; an IPv4-mapped IPv6 address counts as its IPv4. */
export function isCloudMetadataAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return CLOUD_METADATA_RANGES.some(
      ([range, bits]) => range.kind() === parsed.kind() && parsed.match(range, bits)
    );
  } catch {
    return true;
  }
}

const cloudMetadataError = (address: string, host?: string) =>
  new Error(
    `DNS lookup ${address}(host:${host ?? address}) is not allowed. Because, It is a cloud metadata address.`
  );

/** `dns.lookup` that rejects a hostname resolving to a cloud-metadata address. */
export const createCloudMetadataRejectingLookup =
  (baseLookup: LookupFunction = dns.lookup): LookupFunction =>
  (hostname, options, callback) => {
    baseLookup(hostname, options, (err, address, family) => {
      if (err) {
        callback(err, address, family);
        return;
      }
      const resolved = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      const blocked = resolved.find(isCloudMetadataAddress);
      if (blocked) {
        callback(cloudMetadataError(blocked, hostname), address, family);
        return;
      }
      callback(null, address, family);
    });
  };

// Node skips DNS for an IP-literal host, so the literal is checked before connecting.
// A hostname is left to the lookup: isCloudMetadataAddress fails closed on it.
const rejectCloudMetadataLiteral = (options: TcpNetConnectOpts) => {
  if (options.host && isIP(options.host) && isCloudMetadataAddress(options.host)) {
    throw cloudMetadataError(options.host);
  }
};

// Self-hosted deployments commonly keep an operator-configured peer (an SSO identity
// provider) on the private network. These agents admit private addresses and still
// reject the cloud-metadata addresses (request-filtering-agent's own "meta" option
// only covers 0.0.0.0 / ::).
class PrivateNetworkHttpAgent extends RequestFilteringHttpAgent {
  override createConnection(
    options: TcpNetConnectOpts,
    connectionListener?: (error: Error | null, socket: Duplex) => void
  ): Duplex {
    rejectCloudMetadataLiteral(options);
    return super.createConnection(options, connectionListener);
  }
}
class PrivateNetworkHttpsAgent extends RequestFilteringHttpsAgent {
  override createConnection(
    options: TcpNetConnectOpts,
    connectionListener?: (error: Error | null, socket: Duplex) => void
  ): Duplex {
    rejectCloudMetadataLiteral(options);
    return super.createConnection(options, connectionListener);
  }
}
const PRIVATE_NETWORK_AGENT_OPTIONS = {
  keepAlive: true,
  allowPrivateIPAddress: true,
  lookup: createCloudMetadataRejectingLookup(),
};
const PRIVATE_NETWORK_AGENTS = {
  httpAgent: new PrivateNetworkHttpAgent(PRIVATE_NETWORK_AGENT_OPTIONS),
  httpsAgent: new PrivateNetworkHttpsAgent(PRIVATE_NETWORK_AGENT_OPTIONS),
};

export interface ISafeAgentOptions {
  /**
   * Admit private-network peers (loopback, RFC 1918, ...) while still rejecting the
   * cloud-metadata addresses. Only for self-hosted deployments, where the peer is
   * configured by the operator or a tenant of the same instance; cloud stays strict.
   */
  allowPrivateNetwork?: boolean;
}

const selectAgentByProtocol = (parsedUrl: URL) =>
  parsedUrl.protocol === 'https:' ? SAFE_AGENTS.httpsAgent : SAFE_AGENTS.httpAgent;
const selectPrivateNetworkAgentByProtocol = (parsedUrl: URL) =>
  parsedUrl.protocol === 'https:'
    ? PRIVATE_NETWORK_AGENTS.httpsAgent
    : PRIVATE_NETWORK_AGENTS.httpAgent;

/**
 * SSRF-safe http/https agents for axios: `axios.get(url, { ...getSafeAxiosAgents() })`.
 * Returns an empty object (default agents) when protection is disabled via env var.
 */
export function getSafeAxiosAgents(): {
  httpAgent?: RequestFilteringHttpAgent;
  httpsAgent?: RequestFilteringHttpsAgent;
} {
  if (isSsrfProtectionDisabled()) {
    return EMPTY_AGENTS;
  }
  return SAFE_AGENTS;
}

/**
 * SSRF-safe `agent` option for `node-fetch`. The per-URL selector form resolves
 * the request-filtering agent at socket-connect time, so every hop — including
 * redirects — is filtered. Returns `undefined` (default agent) when protection
 * is disabled via env var, in parity with `getSafeAxiosAgents()`.
 */
export function getSafeFetchAgent(
  options?: ISafeAgentOptions
): ((parsedUrl: URL) => RequestFilteringHttpAgent | RequestFilteringHttpsAgent) | undefined {
  if (isSsrfProtectionDisabled()) {
    return undefined;
  }
  return options?.allowPrivateNetwork ? selectPrivateNetworkAgentByProtocol : selectAgentByProtocol;
}
