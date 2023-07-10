import * as React from 'react';
import type { SVGProps } from 'react';
const Diamond = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__a)">
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="m21.299 10.299-7.595-7.595a2.41 2.41 0 0 0-3.408 0L2.702 10.3a2.41 2.41 0 0 0 0 3.408l7.594 7.594a2.41 2.41 0 0 0 3.408 0l7.595-7.594a2.41 2.41 0 0 0 0-3.409Z"
      />
    </g>
    <defs>
      <clipPath id="prefix__a">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default Diamond;
