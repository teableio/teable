/* eslint-disable @typescript-eslint/naming-convention */
import * as Sentry from '@sentry/nestjs';
import type { V2Feature } from '@teable/openapi';
import type { Response } from 'express';
import type { ClsService } from 'nestjs-cls';
import type { IClsStore, IV2Reason } from '../../types/cls';

export const X_TEABLE_V2_HEADER = 'x-teable-v2';
export const X_TEABLE_V2_REASON_HEADER = 'x-teable-v2-reason';
export const X_TEABLE_V2_FEATURE_HEADER = 'x-teable-v2-feature';
export const TEABLE_REQUEST_ATTRIBUTION = 'teable.request.attribution';

export interface IV2Attribution {
  useV2?: boolean;
  v2Reason?: IV2Reason;
  v2Feature?: V2Feature;
}

type SentryScopeLike = {
  setTag(key: string, value: string): void;
};

export const getV2Attribution = (cls?: ClsService<IClsStore>): IV2Attribution => {
  if (!cls) {
    return {};
  }

  try {
    return {
      useV2: cls.get('useV2'),
      v2Reason: cls.get('v2Reason'),
      v2Feature: cls.get('v2Feature'),
    };
  } catch {
    return {};
  }
};

const getRequestAttribution = (useV2: boolean | undefined): 'v1' | 'v2' | undefined => {
  if (useV2 === true) {
    return 'v2';
  }

  if (useV2 === false) {
    return 'v1';
  }

  return undefined;
};

const getSentryScopes = (): SentryScopeLike[] => {
  const sentryApi = Sentry as unknown as {
    getCurrentScope?: () => SentryScopeLike | undefined;
    getIsolationScope?: () => SentryScopeLike | undefined;
    getCurrentHub?: () => { getScope?: () => SentryScopeLike | undefined };
  };

  const scopes = [
    sentryApi.getCurrentScope?.(),
    sentryApi.getIsolationScope?.(),
    sentryApi.getCurrentHub?.()?.getScope?.(),
  ].filter((scope): scope is SentryScopeLike => Boolean(scope));

  return [...new Set(scopes)];
};

const setSentryTag = (
  scope: SentryScopeLike,
  key: string,
  value: string | boolean | undefined
) => {
  if (value == null) {
    return;
  }

  scope.setTag(key, String(value));
};

export const setV2AttributionOnSentryScope = (
  scope: SentryScopeLike,
  attribution: IV2Attribution
) => {
  const requestAttribution = getRequestAttribution(attribution.useV2);

  setSentryTag(scope, 'teable.version', requestAttribution);
  setSentryTag(scope, 'teable.v2.enabled', attribution.useV2);
  setSentryTag(scope, 'teable.v2.reason', attribution.v2Reason);
  setSentryTag(scope, 'teable.v2.feature', attribution.v2Feature);
  setSentryTag(scope, TEABLE_REQUEST_ATTRIBUTION, requestAttribution);
};

export const setV2AttributionOnCurrentSentryScopes = (attribution: IV2Attribution) => {
  for (const scope of getSentryScopes()) {
    setV2AttributionOnSentryScope(scope, attribution);
  }
};

export const getV2AttributionSpanAttributes = (attribution: IV2Attribution) => {
  const requestAttribution = getRequestAttribution(attribution.useV2);

  return {
    ...(requestAttribution && { [TEABLE_REQUEST_ATTRIBUTION]: requestAttribution }),
    ...(attribution.useV2 != null && { 'teable.v2.enabled': attribution.useV2 }),
    ...(attribution.v2Reason && { 'teable.v2.reason': attribution.v2Reason }),
    ...(attribution.v2Feature && { 'teable.v2.feature': attribution.v2Feature }),
  };
};

export const getV2AttributionLogContext = (attribution: IV2Attribution) => {
  const requestAttribution = getRequestAttribution(attribution.useV2);

  if (!requestAttribution && !attribution.v2Reason && !attribution.v2Feature) {
    return undefined;
  }

  return {
    attribution: requestAttribution,
    enabled: attribution.useV2,
    reason: attribution.v2Reason,
    feature: attribution.v2Feature,
  };
};

export const setV2AttributionHeaders = (
  response: Response,
  attribution: IV2Attribution
) => {
  if (response.headersSent || response.writableEnded || response.destroyed) {
    return;
  }

  if (attribution.useV2 != null) {
    response.setHeader(X_TEABLE_V2_HEADER, attribution.useV2 ? 'true' : 'false');
  }
  if (attribution.v2Reason) {
    response.setHeader(X_TEABLE_V2_REASON_HEADER, attribution.v2Reason);
  }
  if (attribution.v2Feature) {
    response.setHeader(X_TEABLE_V2_FEATURE_HEADER, attribution.v2Feature);
  }
};
