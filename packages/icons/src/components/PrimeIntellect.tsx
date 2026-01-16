import * as React from 'react';
import type { SVGProps } from 'react';
const PrimeIntellect = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#8B5CF6" rx={4} />
    <path
      fill="#fff"
      d="M8 7h4c1.66 0 3 1.34 3 3s-1.34 3-3 3h-2v4H8zm2 4h2c.55 0 1-.45 1-1s-.45-1-1-1h-2z"
    />
  </svg>
);
export default PrimeIntellect;
