import * as React from 'react';
import type { SVGProps } from 'react';
const Strikethrough = (props: SVGProps<SVGSVGElement>) => (
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
      d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 1 1 0 8H6M4 12h16"
    />
  </svg>
);
export default Strikethrough;
