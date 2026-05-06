import * as React from 'react';
import type { SVGProps } from 'react';
const Recraft = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 80 80"
    {...props}
  >
    <rect width={80} height={80} fill="#000" rx={16} />
    <g clipPath="url(#prefix__recraft)" clipRule="evenodd">
      <path
        fill="#fff"
        d="M56.56 30.743c0-10.175-9.239-18.424-20.636-18.424-3.953 0-7.155 8.25-7.155 18.424 0 2.545.2 4.971.564 7.178h-7.006L15 63.522h20.926V49.17c11.394 0 20.63-8.252 20.63-18.424zm-20.636-15.05c2.068 0 3.743 6.74 3.743 15.05s-1.675 15.05-3.743 15.05-3.743-6.74-3.743-15.05 1.675-15.05 3.743-15.05"
      />
      <path fill="#fff" d="M56.963 49.17H35.945l8.06 14.355H65.02z" />
    </g>
    <defs>
      <clipPath id="prefix__recraft">
        <path fill="#fff" d="M15 12.32h50.02v51.205H15z" />
      </clipPath>
    </defs>
  </svg>
);
export default Recraft;
