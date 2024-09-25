import type { ReactNode } from 'react';
import { useState } from 'react';
import { LinkFilterContext } from './LinkFilterContext';

export interface ILinkFilterProviderProps {
  filterLinkCellCandidate?: [string, string] | string;
  filterLinkCellSelected?: [string, string] | string;
  children?: ReactNode;
}

export const LinkFilterProvider: React.FC<ILinkFilterProviderProps> = (props) => {
  const [filterLinkCellCandidate, setLinkCellCandidate] = useState<
    [string, string] | string | undefined
  >(props.filterLinkCellCandidate);
  const [filterLinkCellSelected, setLinkCellSelected] = useState<
    [string, string] | string | undefined
  >(props.filterLinkCellSelected);

  return (
    <LinkFilterContext.Provider
      value={{
        filterLinkCellSelected,
        filterLinkCellCandidate,
        setLinkCellCandidate: (value: string[] | string) => {
          setLinkCellCandidate(
            Array.isArray(value)
              ? value.length === 2
                ? (value as [string, string])
                : (value[0] as string)
              : (value as string)
          );
          setLinkCellSelected(undefined);
        },
        setLinkCellSelected: (value: string[] | string) => {
          setLinkCellCandidate(undefined);
          setLinkCellSelected(
            Array.isArray(value)
              ? value.length === 2
                ? (value as [string, string])
                : (value[0] as string)
              : (value as string)
          );
        },
      }}
    >
      {props.children}
    </LinkFilterContext.Provider>
  );
};
