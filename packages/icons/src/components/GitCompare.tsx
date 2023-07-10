import * as React from 'react';
import type { SVGProps } from 'react';
const GitCompare = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9"
    />
  </svg>
);
export default GitCompare;
