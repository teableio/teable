import * as React from 'react';
import type { SVGProps } from 'react';
const Bfl = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={20} height={20} x={2} y={2} fill="#1A1A1A" rx={4} />
    <path
      fill="#fff"
      d="M6 6h4c2 0 3 1 3 2.5S12 11 10 11H8v2h2c2 0 3 1 3 2.5S12 18 10 18H6zm2 3h2c.5 0 1-.25 1-.75S10.5 7.5 10 7.5H8zm0 5h2c.5 0 1-.25 1-.75s-.5-.75-1-.75H8z"
    />
    <path fill="#fff" d="M14 6h2v10h4v2h-6z" />
  </svg>
);
export default Bfl;
