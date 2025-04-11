import * as React from 'react';
import type { SVGProps } from 'react';
const SendMail = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={24} height={24} fill="#2684FF" fillOpacity={0.3} rx={3} />
    <path
      fill="#2684FF"
      stroke="#2684FF"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17.6 7H6.4C5.627 7 5 7.56 5 8.25v7.5c0 .69.627 1.25 1.4 1.25h11.2c.773 0 1.4-.56 1.4-1.25v-7.5C19 7.56 18.373 7 17.6 7"
    />
    <g filter="url(#prefix__send-mail)" shapeRendering="crispEdges">
      <path
        fill="#2684FF"
        fillOpacity={0.6}
        d="m18 10-5.382 2.852A1.34 1.34 0 0 1 12 13a1.34 1.34 0 0 1-.618-.148L6 10"
      />
      <path
        stroke="#93C5FD"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="m18 10-5.382 2.852A1.34 1.34 0 0 1 12 13a1.34 1.34 0 0 1-.618-.148L6 10"
      />
    </g>
    <defs>
      <filter
        id="prefix__send-mail"
        width={22}
        height={13}
        x={1}
        y={9}
        colorInterpolationFilters="sRGB"
        filterUnits="userSpaceOnUse"
      >
        <feFlood floodOpacity={0} result="BackgroundImageFix" />
        <feColorMatrix
          in="SourceAlpha"
          result="hardAlpha"
          values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
        />
        <feOffset dy={4} />
        <feGaussianBlur stdDeviation={2} />
        <feComposite in2="hardAlpha" operator="out" />
        <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
        <feBlend in2="BackgroundImageFix" result="effect1_dropShadow_5170_120" />
        <feBlend in="SourceGraphic" in2="effect1_dropShadow_5170_120" result="shape" />
      </filter>
    </defs>
  </svg>
);
export default SendMail;
