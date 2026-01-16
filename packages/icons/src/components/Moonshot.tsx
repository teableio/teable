import * as React from 'react';
import type { SVGProps } from 'react';
const Moonshot = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <circle cx={12} cy={12} r={11} fill="#000" />
    <path
      fill="#fff"
      d="M12 4C7.582 4 4 7.582 4 12s3.582 8 8 8c1.848 0 3.555-.63 4.91-1.686A6.5 6.5 0 0 1 12 8.5a6.47 6.47 0 0 1 4.91-2.186A7.96 7.96 0 0 0 12 4"
    />
    <circle cx={15} cy={9} r={2} fill="#fff" />
  </svg>
);
export default Moonshot;
