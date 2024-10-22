import type { ReactNode } from 'react';
import { useState } from 'react';
import { LinkFilterContext } from './LinkFilterContext';

export interface ILinkFilterProviderProps {
  filterLinkCellCandidate?: [string, string] | string;
  filterLinkCellSelected?: [string, string] | string;
  selectedRecordIds?: string[];
  children?: ReactNode;
}

export const LinkFilterProvider: React.FC<ILinkFilterProviderProps> = (props) => {
  const [filterLinkCellCandidate, setLinkCellCandidate] = useState<
    [string, string] | string | undefined
  >(props.filterLinkCellCandidate);
  const [filterLinkCellSelected, setLinkCellSelected] = useState<
    [string, string] | string | undefined
  >(props.filterLinkCellSelected);
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[] | undefined>(
    props.selectedRecordIds
  );

  return (
    <LinkFilterContext.Provider
      value={{
        selectedRecordIds,
        filterLinkCellSelected,
        filterLinkCellCandidate,
        setSelectedRecordIds,
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
      }}
    >
      {props.children}
    </LinkFilterContext.Provider>
  );
};
