import * as React from 'react';
import type { SVGProps } from 'react';
const LayoutTemplate = (props: SVGProps<SVGSVGElement>) => (
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
      d="M21 3H3v7h18zM21 14h-5v7h5zM12 14H3v7h9z"
    />
  </svg>
);
export default LayoutTemplate;
