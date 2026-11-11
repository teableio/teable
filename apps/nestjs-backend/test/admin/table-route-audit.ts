import type { INestApplication } from '@nestjs/common';
import { resolveBoolean } from '../../src/features/v2/v2-config-parsers';
import { collectRegisteredRoutes, type IRegisteredRoute } from '../utils/route-inventory';
import {
  TABLE_ROUTE_CONTROLLERS,
  TABLE_ROUTE_EDITIONS,
  TABLE_ROUTE_FLAGS,
  TABLE_ROUTE_LEDGER,
  TABLE_ROUTE_PATH_PATTERNS,
  type TableRouteDecision,
} from './table-route-ledger';

export type TableRouteEdition = 'CE' | 'EE';

export interface ITableRouteAudit {
  missing: string[];
  stale: string[];
  invalid: string[];
}

const isDecision = (value: string): value is TableRouteDecision =>
  value === 'v2' || value === 'v2-only' || value === 'host' || /^v1:[A-Z][A-Z0-9_-]*$/.test(value);

const flagEnabled = (name: string): boolean => resolveBoolean(process.env[name], false);

export const isTableRoute = (route: IRegisteredRoute): boolean =>
  route.controllers.some((controller) => controller in TABLE_ROUTE_CONTROLLERS) ||
  TABLE_ROUTE_PATH_PATTERNS.some((pattern) => pattern.test(route.path));

/** Applies edition and feature-flag conditions before a ledger entry can become stale. */
const applicable = (key: string, edition: TableRouteEdition): boolean => {
  if (TABLE_ROUTE_EDITIONS[key] === 'EE' && edition === 'CE') return false;
  const flags = TABLE_ROUTE_FLAGS[key];
  return !flags || flags.some(flagEnabled);
};

export const auditTableRoutes = (
  app: INestApplication,
  edition: TableRouteEdition
): ITableRouteAudit => {
  const routes = collectRegisteredRoutes(app);
  const missing = [...routes.values()]
    .filter((route) => isTableRoute(route) && !(route.key in TABLE_ROUTE_LEDGER))
    .map(
      (route) =>
        `  '${route.key}': 'v1:T8416', // ${route.controllers.join(' | ') || 'unresolved declaration'}`
    );
  const stale = Object.keys(TABLE_ROUTE_LEDGER).filter(
    (key) => applicable(key, edition) && !routes.has(key)
  );
  const invalid = Object.entries(TABLE_ROUTE_LEDGER)
    .filter(([, decision]) => !isDecision(decision))
    .map(([key, decision]) => `${key}: ${decision}`);
  return { missing, stale, invalid };
};
