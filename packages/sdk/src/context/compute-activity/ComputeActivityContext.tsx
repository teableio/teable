import { createContext, useContext } from 'react';
import type { IComputeActivityState } from '../../hooks/use-compute-activity';

export type IComputeActivityContext = IComputeActivityState;

export const ComputeActivityContext = createContext<IComputeActivityContext | null>(null);

export function useComputeActivityContext(): IComputeActivityContext | null {
  return useContext(ComputeActivityContext);
}
