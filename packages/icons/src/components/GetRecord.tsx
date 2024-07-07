import * as React from 'react';
import type { SVGProps } from 'react';
const GetRecord = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={24} height={24} fill="#FDE68A" rx={3} />
    <path
      fill="#FDE68A"
      d="M20.942 0H3.058A3.06 3.06 0 0 0 0 3.058v17.884A3.06 3.06 0 0 0 3.058 24h17.884A3.063 3.063 0 0 0 24 20.942V3.058A3.064 3.064 0 0 0 20.942 0m1.072 20.942c0 .592-.483 1.075-1.075 1.075H3.058a1.08 1.08 0 0 1-1.075-1.075V3.058c0-.592.483-1.075 1.075-1.075h17.884c.592 0 1.075.483 1.075 1.075v17.884z"
    />
    <path
      stroke="#FBBF24"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m18 18-2.9-2.9m1.567-3.767a5.333 5.333 0 1 1-10.667 0 5.333 5.333 0 0 1 10.667 0"
    />
  </svg>
);
export default GetRecord;
