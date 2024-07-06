import * as React from 'react';
import type { SVGProps } from 'react';
const UpdateRecord = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__a)">
      <rect width={24} height={24} fill="#2684FF" rx={3} />
      <path
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.882 17.941 18 9.824 15.177 7l-8.118 8.118L6 19zM18 5l2 2"
      />
    </g>
    <defs>
      <clipPath id="prefix__a">
        <rect width={24} height={24} fill="#fff" rx={3} />
      </clipPath>
    </defs>
  </svg>
);
export default UpdateRecord;
