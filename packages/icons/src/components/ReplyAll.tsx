import * as React from 'react';
import type { SVGProps } from 'react';
const ReplyAll = (props: SVGProps<SVGSVGElement>) => (
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
      d="m7 17-5-5 5-5M12 17l-5-5 5-5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M22 18v-2a4 4 0 0 0-4-4H7"
    />
  </svg>
);
export default ReplyAll;
