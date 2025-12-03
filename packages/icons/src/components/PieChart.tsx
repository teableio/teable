import * as React from 'react';
import type { SVGProps } from 'react';
const PieChart = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 40 40"
    {...props}
  >
    <path
      d="M19.0811 22H34.8672C33.8894 29.3387 27.6061 35 20 35C11.7157 35 5 28.2843 5 20C5 16.168 6.43729 12.6719 8.80176 10.0205L19.0811 22Z"
      fill="#D4D4D8"
    />
    <path
      d="M34.9998 20C34.9998 17.1306 34.1768 14.3214 32.6284 11.9057C31.0801 9.48992 28.8713 7.56896 26.2641 6.37066C23.6569 5.17235 20.7607 4.74699 17.919 5.14503C15.0774 5.54307 12.4095 6.7478 10.2319 8.61633L19.7005 19.6512C19.8905 19.8726 20.1677 20 20.4594 20H34.9998Z"
      fill="#27272A"
    />
  </svg>
);
export default PieChart;
