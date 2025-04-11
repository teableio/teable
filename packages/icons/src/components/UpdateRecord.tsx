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
    <g clipPath="url(#prefix__update-record)">
      <rect width={24} height={24} fill="#A7F3D0" rx={3} />
      <path
        stroke="#22C55E"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.235 17.118 16 10.353 13.647 8l-6.765 6.765L6 18zM16 6l2 2"
      />
    </g>
    <defs>
      <clipPath id="prefix__update-record">
        <rect width={24} height={24} fill="#fff" rx={3} />
      </clipPath>
    </defs>
  </svg>
);
export default UpdateRecord;
