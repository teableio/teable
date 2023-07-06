import * as React from 'react';
import type { SVGProps } from 'react';
const Bold = (props: SVGProps<SVGSVGElement>) => (
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
      d="M6 4h8a4 4 0 1 1 0 8H6V4ZM6 12h9a4 4 0 1 1 0 8H6v-8Z"
    />
  </svg>
);
export default Bold;
