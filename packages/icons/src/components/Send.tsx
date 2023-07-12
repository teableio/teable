import * as React from 'react';
import type { SVGProps } from 'react';
const Send = (props: SVGProps<SVGSVGElement>) => (
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
      d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
    />
  </svg>
);
export default Send;
