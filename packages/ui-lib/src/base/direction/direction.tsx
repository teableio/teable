'use client';

import * as React from 'react';

export type IUiDirection = 'ltr' | 'rtl';

const DirectionContext = React.createContext<IUiDirection>('ltr');

/**
 * Reading direction for the primitives in this package.
 *
 * Radix ships its own `DirectionProvider`, but `@radix-ui/react-direction`
 * resolves to three different versions across the dependency tree, so a single
 * Radix provider would only reach the consumers that happen to share its copy.
 * Radix's `useDirection(localDir)` prefers an explicitly passed `dir` over the
 * context, so this package keeps one context of its own and hands the value to
 * each primitive by prop instead — version-proof, and it keeps the direction in
 * one place rather than at every call site.
 */
export const UiDirectionProvider = (props: { dir: IUiDirection; children: React.ReactNode }) => (
  <DirectionContext.Provider value={props.dir}>{props.children}</DirectionContext.Provider>
);

export const useUiDirection = (): IUiDirection => React.useContext(DirectionContext);
