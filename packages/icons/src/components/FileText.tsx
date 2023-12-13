import * as React from 'react';
import type { SVGProps } from 'react';
const FileText = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__a)">
      <path
        fill="#6F8BB5"
        fillRule="evenodd"
        d="M2.88 0A2.88 2.88 0 0 0 0 2.88v18.24A2.88 2.88 0 0 0 2.88 24h18.24A2.88 2.88 0 0 0 24 21.12V2.88A2.88 2.88 0 0 0 21.12 0zm12.684 7.48a1.957 1.957 0 0 0-.41-.04h-6.27c-.14 0-.276.013-.408.04a.479.479 0 0 0-.317.224c-.08.114-.119.312-.119.594s.04.484.119.607c.079.115.185.19.317.225.132.026.268.04.409.04h2.151v6.52c0 .167.014.33.04.488.026.15.11.273.25.37.142.088.37.132.687.132.326 0 .555-.044.687-.132a.558.558 0 0 0 .25-.37 2.07 2.07 0 0 0 .053-.475V9.17h2.125c.15 0 .29-.013.423-.04a.479.479 0 0 0 .317-.224c.088-.123.132-.321.132-.594 0-.29-.044-.493-.132-.607a.476.476 0 0 0-.304-.224"
        clipRule="evenodd"
      />
    </g>
    <defs>
      <clipPath id="prefix__a">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileText;
