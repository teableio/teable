import { Relationship } from '@teable/core';

const buildMarkerId = (baseId: string) => {
  return {
    one: `${baseId}-one`,
    many: `${baseId}-many`,
  };
};

export const getMarker = (baseId: string, relationship: Relationship) => {
  const { one, many } = buildMarkerId(baseId);
  switch (relationship) {
    case Relationship.OneOne:
      return { start: one, end: one };
    case Relationship.ManyMany:
      return { start: many, end: many };
    case Relationship.ManyOne:
      return { start: many, end: one };
    case Relationship.OneMany:
      return { start: one, end: many };
  }
};
export const CustomMarkers = ({ baseId }: { baseId: string }) => {
  // same color as reactflow default marker
  const color = 'rgb(177, 177, 183)';
  return (
    <svg style={{ position: 'absolute', top: 0, left: 0 }}>
      <defs>
        <marker
          id={buildMarkerId(baseId).one}
          markerWidth="16"
          markerHeight="16"
          viewBox="-10 -10 20 20"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
          refX="-5"
          refY="0"
        >
          <circle cx="0" cy="0" r="5" fill="none" stroke={color} strokeWidth="1"></circle>
        </marker>
        <marker
          id={buildMarkerId(baseId).many}
          markerWidth="16"
          markerHeight="16"
          viewBox="-10 -10 20 20"
          markerUnits="strokeWidth"
          orient="auto-start-reverse"
          refX="0"
          refY="4"
        >
          <rect
            x="0"
            y="0"
            width="8"
            height="8"
            fill="none"
            stroke={color}
            strokeWidth="1"
            transform="rotate(45,4,4)"
          ></rect>
        </marker>
      </defs>
    </svg>
  );
};
