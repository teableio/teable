import * as React from 'react';
import type { SVGProps } from 'react';
const LayoutList = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 14H3v7h7zM10 3H3v7h7zM14 4h7M14 9h7M14 15h7M14 20h7"
    />
  </svg>
);
export default LayoutList;
