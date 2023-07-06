import * as React from 'react';
import type { SVGProps } from 'react';
const Frame = (props: SVGProps<SVGSVGElement>) => (
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
      d="M22 6H2M22 18H2M6 2v20M18 2v20"
    />
  </svg>
);
export default Frame;
