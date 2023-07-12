import * as React from 'react';
import type { SVGProps } from 'react';
const Rewind = (props: SVGProps<SVGSVGElement>) => (
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
      d="m11 19-9-7 9-7v14ZM22 19l-9-7 9-7v14Z"
    />
  </svg>
);
export default Rewind;
