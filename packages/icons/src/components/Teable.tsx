import * as React from 'react';
import type { SVGProps } from 'react';
const Teable = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 27"
    {...props}
  >
    <path
      fill="url(#prefix__teable)"
      d="m10.665 21.247-.09-12.258a.5.5 0 0 0-.277-.443L4.43 5.607a.5.5 0 0 1 .064-.92l5.824-1.967a.5.5 0 0 1 .32 0l7.747 2.605a.5.5 0 0 1 .295.682L11.62 21.45c-.223.487-.95.331-.955-.204"
    />
    <defs>
      <linearGradient
        id="prefix__teable"
        x1={10.536}
        x2={10.536}
        y1={1}
        y2={27}
        gradientUnits="userSpaceOnUse"
      >
        <stop stopColor="#DE40A9" />
        <stop offset={1} stopColor="#7D18CD" />
      </linearGradient>
    </defs>
  </svg>
);
export default Teable;
