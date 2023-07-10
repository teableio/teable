import * as React from 'react';
import type { SVGProps } from 'react';
const Code2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="m18 16 4-4-4-4M6 8l-4 4 4 4M14.5 4l-5 16"
    />
  </svg>
);
export default Code2;
