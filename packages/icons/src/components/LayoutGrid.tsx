import * as React from 'react';
import type { SVGProps } from 'react';
const LayoutGrid = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 3H3v7h7zM21 3h-7v7h7zM21 14h-7v7h7zM10 14H3v7h7z"
    />
  </svg>
);
export default LayoutGrid;
