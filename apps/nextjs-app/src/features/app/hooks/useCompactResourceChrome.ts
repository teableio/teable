import { createContext, useContext } from 'react';

/**
 * A host that shows resources in a narrower pane (the chat-first space shell, beside the
 * conversation) asks for lighter page chrome here: the tab already names the resource, so the
 * table drops its title block, folds its views into one menu and its toolbar extras into "more".
 */
export const CompactResourceChromeContext = createContext(false);

export const useCompactResourceChrome = () => useContext(CompactResourceChromeContext);
