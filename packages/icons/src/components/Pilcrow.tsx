import * as React from 'react';
import type { SVGProps } from 'react';
const Pilcrow = (props: SVGProps<SVGSVGElement>) => (
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
      d="M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13"
    />
  </svg>
);
export default Pilcrow;
