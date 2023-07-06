import * as React from 'react';
import type { SVGProps } from 'react';
const FileScan = (props: SVGProps<SVGSVGElement>) => (
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
      d="M20 10V7.5L14.5 2H6a2 2 0 0 0-2 2v16c0 1.1.9 2 2 2h4.5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M14 2v6h6M16 22a2 2 0 0 1-2-2M20 22a2 2 0 0 0 2-2M20 14a2 2 0 0 1 2 2M16 14a2 2 0 0 0-2 2"
    />
  </svg>
);
export default FileScan;
