import { noop } from 'lodash';
import { useContext } from 'react';
import { LinkFilterContext } from '../context/query';

export function useLinkFilter() {
  const linkFilter = useContext(LinkFilterContext);

  return {
    ...linkFilter,
    setLinkCellCandidate: linkFilter.setLinkCellCandidate || noop,
    setLinkCellSelected: linkFilter.setLinkCellSelected || noop,
    setListType: linkFilter.setListType || noop,
  };
}
