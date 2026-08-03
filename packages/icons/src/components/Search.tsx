import * as React from 'react';
import type { SVGProps } from 'react';
const Search = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m21 21-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
    />
  </svg>
);
export default Search;
