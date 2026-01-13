import React from 'react';

interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export function Sparkline({
  points,
  width = 120,
  height = 28,
  stroke = '#9CA3AF', // neutral gray
  strokeWidth = 1.5,
  fill = 'none',
}: SparklineProps) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * (width - 2);
      const y = height - 2 - ((p - min) / range) * (height - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={path} stroke={stroke} strokeWidth={strokeWidth} fill={fill} strokeLinecap="round" />
    </svg>
  );
}