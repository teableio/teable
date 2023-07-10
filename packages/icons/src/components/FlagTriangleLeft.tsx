import * as React from 'react';
import type { SVGProps } from 'react';
const FlagTriangleLeft = (props: SVGProps<SVGSVGElement>) => (
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
      d="M17 22V2L7 7l10 5"
    />
  </svg>
);
export default FlagTriangleLeft;
