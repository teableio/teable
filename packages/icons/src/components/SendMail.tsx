import * as React from 'react';
import type { SVGProps } from 'react';
const SendMail = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={24} height={24} fill="#2684FF" rx={3} />
    <path
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m19 8-6.279 3.803a1.41 1.41 0 0 1-1.442 0L5 8"
    />
    <path
      stroke="#fff"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18.4 6H5.6C4.716 6 4 6.672 4 7.5v9c0 .828.716 1.5 1.6 1.5h12.8c.884 0 1.6-.672 1.6-1.5v-9c0-.828-.716-1.5-1.6-1.5"
    />
  </svg>
);
export default SendMail;
