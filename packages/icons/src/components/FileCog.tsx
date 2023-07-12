import * as React from 'react';
import type { SVGProps } from 'react';
const FileCog = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4 6V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H4"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M14 2v6h6M6 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 10v1M6 17v1M10 14H9M3 14H2M9 11l-.88.88M3.88 16.12 3 17M9 17l-.88-.88M3.88 11.88 3 11"
    />
  </svg>
);
export default FileCog;
