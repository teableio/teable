import type { DomainError, DomainErrorTag } from '@teable/v2-core';

export type { DomainError, DomainErrorTag };

export interface IVcsErrorParams {
  readonly code?: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

const makeVcsDomainError = (tag: DomainErrorTag, params: IVcsErrorParams): DomainError => {
  const errObj: Record<string, unknown> = {
    code: params.code ?? `vcs.${tag}`,
    message: params.message,
    tags: [tag] as const,
    ...(params.details ? { details: params.details } : {}),
  };

  Object.defineProperty(errObj, 'toString', {
    value: () => `[${errObj.code as string}] ${errObj.message as string}`,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  if (params.cause !== undefined) {
    Object.defineProperty(errObj, 'cause', {
      value: params.cause,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  return errObj as unknown as DomainError;
};

/**
 * Lightweight DomainError constructors compatible with `@teable/v2-core`'s
 * `DomainError` shape without importing the entire v2-core barrel at runtime.
 */
export const vcsDomainError = {
  validation: (params: IVcsErrorParams): DomainError => makeVcsDomainError('validation', params),
  conflict: (params: IVcsErrorParams): DomainError => makeVcsDomainError('conflict', params),
  notFound: (params: IVcsErrorParams): DomainError => makeVcsDomainError('not-found', params),
  invariant: (params: IVcsErrorParams): DomainError => makeVcsDomainError('invariant', params),
  forbidden: (params: IVcsErrorParams): DomainError => makeVcsDomainError('forbidden', params),
  unauthorized: (params: IVcsErrorParams): DomainError =>
    makeVcsDomainError('unauthorized', params),
  infrastructure: (params: IVcsErrorParams): DomainError =>
    makeVcsDomainError('infrastructure', params),
  unexpected: (params: IVcsErrorParams): DomainError => makeVcsDomainError('unexpected', params),
};
