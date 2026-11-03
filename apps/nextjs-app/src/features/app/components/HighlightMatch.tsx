import { escapeRegExp } from 'lodash';
import { Fragment } from 'react';

/** Whether the text contains the query, which the caller has lowercased: what HighlightMatch marks. */
export const matchesQuery = (text: string, query: string) =>
  text.toLocaleLowerCase().includes(query);

/** The text with each case-insensitive occurrence of the query bold and blue, as a search result. */
export const HighlightMatch = ({ text, query }: { text: string; query?: string }) => {
  if (!query) return <>{text}</>;
  // Splitting on a captured pattern puts every match at an odd index.
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index % 2 ? (
            <strong className="font-semibold text-blue-600 dark:text-blue-500">{part}</strong>
          ) : (
            part
          )}
        </Fragment>
      ))}
    </>
  );
};
