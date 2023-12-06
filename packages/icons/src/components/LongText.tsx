import * as React from 'react';
import type { SVGProps } from 'react';
const LongText = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path fill="#fff" fillOpacity={0.01} d="M0 0h24v24H0z" />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2.353}
      d="m2 21 2.47-6m0 0 1.03-2.5L9 4l3.5 8.5 1.03 2.5m-9.06 0h9.06M16 21l-2.47-6M14 5h8M16 10h6M18 15h4M20 20h2"
    />
  </svg>
);
export default LongText;
