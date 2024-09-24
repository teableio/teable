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
        setLinkCellCandidate: (value: string[]) => {
          setLinkCellCandidate(value as [string, string]);
          setLinkCellSelected(undefined);
        },
        setLinkCellSelected: (value) => {
          setLinkCellCandidate(undefined);
          setLinkCellSelected(value as [string, string]);
        },
      }}
    >
      {props.children}
    </LinkFilterContext.Provider>
  );
};
