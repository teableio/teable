import * as React from 'react';
import type { SVGProps } from 'react';
const Volume = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 5 6 9H2v6h4l5 4V5Z"
    />
  </svg>
);
export default Volume;
