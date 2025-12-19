import 'reflect-metadata';

import {
  container,
  delay,
  inject,
  injectable,
  injectAll,
  injectAllWithTransform,
  injectWithTransform,
  Lifecycle,
  registry,
  scoped,
  singleton,
} from 'tsyringe';

import type { DependencyContainer, InjectionToken } from 'tsyringe';

export type { DependencyContainer, InjectionToken };

export {
  container,
  delay,
  inject,
  injectable,
  injectAll,
  injectAllWithTransform,
  injectWithTransform,
  Lifecycle,
  registry,
  scoped,
  singleton,
};

export const createToken = <T>(description: string): InjectionToken<T> =>
  Symbol(description) as InjectionToken<T>;

export const createChildContainer = (): DependencyContainer => container.createChildContainer();
