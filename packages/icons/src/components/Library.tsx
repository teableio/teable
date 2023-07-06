import * as React from 'react';
import type { SVGProps } from 'react';
const Library = (props: SVGProps<SVGSVGElement>) => (
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
      d="m16 6 4 14M12 6v14M8 8v12M4 4v16"
    />
  </svg>
);
export default Library;
