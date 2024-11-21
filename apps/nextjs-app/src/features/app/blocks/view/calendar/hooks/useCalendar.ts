import { useContext } from 'react';
import { CalendarContext } from '../context';

export const useCalendar = () => {
  return useContext(CalendarContext);
};
