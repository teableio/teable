import type { PropsWithChildren } from 'react';
import { createContext, useContext, useMemo } from 'react';

export type StaticTextRegistry = Record<string, Record<string, string>>;

export type StaticTextResolver = (domain: string, key: string) => unknown | undefined;

type StaticTextContextValue = {
  registry: StaticTextRegistry;
  resolver?: StaticTextResolver;
};

const EMPTY_REGISTRY: StaticTextRegistry = Object.freeze({});
const EMPTY_CONTEXT = Object.freeze({
  registry: EMPTY_REGISTRY,
  resolver: undefined as StaticTextResolver | undefined,
});

const StaticTextRegistryContext = createContext<StaticTextContextValue>(EMPTY_CONTEXT);

export const buildStaticTextKey = (...parts: Array<string | undefined | null>) => {
  return parts.filter((part): part is string => Boolean(part)).join(':');
};

export const getStaticTextByMap = (registry: StaticTextRegistry, domain?: string, key?: string) => {
  if (!domain || !key) {
    return;
  }
  return registry[domain]?.[key];
};

export const StaticTextRegistryProvider = ({
  children,
  registry,
  resolver,
}: PropsWithChildren<{ registry?: StaticTextRegistry; resolver?: StaticTextResolver }>) => {
  const contextValue = useMemo(
    () => ({
      registry: registry ?? EMPTY_REGISTRY,
      resolver,
    }),
    [registry, resolver]
  );

  return (
    <StaticTextRegistryContext.Provider value={contextValue}>
      {children}
    </StaticTextRegistryContext.Provider>
  );
};

export const useStaticText = (domain?: string, key?: string) => {
  const { registry } = useContext(StaticTextRegistryContext);
  return getStaticTextByMap(registry, domain, key);
};

export const useStaticResolver = (domain: string, key: string) => {
  const { resolver } = useContext(StaticTextRegistryContext);
  return resolver?.(domain, key);
};
