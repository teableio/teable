import type { ReactNode } from 'react';
import { useState } from 'react';
import { LinkListType } from '../../components/editor/link/interface';
import { LinkFilterContext } from './LinkFilterContext';

export interface ILinkFilterProviderProps {
  filterLinkCellCandidate?: [string, string] | string;
  filterLinkCellSelected?: [string, string] | string;
  selectedRecordIds?: string[];
  listType?: LinkListType;
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
  const [listType, setListType] = useState<LinkListType>(props.listType ?? LinkListType.Unselected);

  return (
    <LinkFilterContext.Provider
      value={{
        selectedRecordIds,
        filterLinkCellSelected,
        filterLinkCellCandidate,
        listType,
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
          setLinkCellSelected(undefined);
          setLinkCellCandidate(
            Array.isArray(value)
              ? value.length === 2
                ? (value as [string, string])
                : (value[0] as string)
              : (value as string)
          );
        },
        setListType: (value: LinkListType) => {
          setListType(value);
          if (value === LinkListType.Selected) {
            setLinkCellCandidate(undefined);
          } else {
            setLinkCellSelected(undefined);
          }
        },
      }}
    >
      {props.children}
    </LinkFilterContext.Provider>
  );
};
