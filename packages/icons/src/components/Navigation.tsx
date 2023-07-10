import * as React from 'react';
import type { SVGProps } from 'react';
const Navigation = (props: SVGProps<SVGSVGElement>) => (
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
      d="m3 11 19-9-9 19-2-8-8-2Z"
    />
  </svg>
);
export default Navigation;
