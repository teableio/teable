import { useContext } from 'react';
import { AppContext } from '../context/app/AppContext';
import { useConnection } from './use-connection';

/**
 * The connection to open presence channels on, or undefined where the page must not.
 *
 * A template preview shows a frozen snapshot base: nothing changes there while it is previewed, so
 * none of its live presence (record/schema refreshes, button runs, sidebar nodes, imports,
 * comments) carries anything, and the server refuses presence to template connections outright.
 * Every presence subscriber takes its connection from here, so a new one is gated by default.
 */
export const usePresenceConnection = () => {
  const { connection } = useConnection();
  const { template } = useContext(AppContext) || {};
  return template ? undefined : connection;
};
