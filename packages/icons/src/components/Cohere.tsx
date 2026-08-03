import * as React from 'react';
import type { SVGProps } from 'react';
const Cohere = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__cohere)">
      <path
        fill="#39594D"
        d="M7.775 14.288c.645 0 1.931-.036 3.705-.767 2.07-.852 6.188-2.4 9.158-3.988 2.078-1.11 2.987-2.581 2.987-4.56A4.97 4.97 0 0 0 18.653 0H7.144A7.144 7.144 0 0 0 0 7.144c0 3.944 2.994 7.144 7.775 7.144"
      />
      <path
        fill="#D18EE2"
        d="M9.72 19.207a4.785 4.785 0 0 1 2.95-4.42l3.626-1.504c3.666-1.52 7.702 1.173 7.702 5.143a5.566 5.566 0 0 1-5.57 5.567h-3.924a4.784 4.784 0 0 1-4.784-4.786"
      />
      <path
        fill="#FF7759"
        d="M4.118 15.23A4.117 4.117 0 0 0 0 19.348v.533a4.118 4.118 0 0 0 8.236 0v-.533a4.12 4.12 0 0 0-4.118-4.118z"
      />
    </g>
    <defs>
      <clipPath id="prefix__cohere">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default Cohere;
