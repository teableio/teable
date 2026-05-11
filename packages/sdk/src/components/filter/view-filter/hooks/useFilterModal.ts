import { useContext } from 'react';
import { FilterModalContext } from '../context';

export const useFilterModal = () => useContext(FilterModalContext);
