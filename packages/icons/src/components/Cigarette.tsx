import * as React from 'react';
import type { SVGProps } from 'react';
const Cigarette = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 12H2v4h16M22 12v4M7 12v4M18 8c0-2.5-2-2.5-2-5M22 8c0-2.5-2-2.5-2-5"
    />
  </svg>
);
export default Cigarette;
