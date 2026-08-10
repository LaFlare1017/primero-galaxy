'use client';
import { motion } from 'framer-motion';
import { Company } from '@/types';
import { DIMENSIONS } from '@/lib/constants';
import { SECTOR_MEDIAN } from '@/lib/fortune500-data';

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 74;
const ANGLES = DIMENSIONS.map((_, i) => (Math.PI * 2 * i) / DIMENSIONS.length - Math.PI / 2);

function polar(score: number, angle: number, r = RADIUS) {
  const radius = (score / 100) * r;
  return {
    x: CENTER + radius * Math.cos(angle),
    y: CENTER + radius * Math.sin(angle),
  };
}

export function RadarChart({ company }: { company: Company }) {
  const polygonPoints = DIMENSIONS.map((d, i) => {
    const p = polar(company.maturity[d.key], ANGLES[i]);
    return `${p.x},${p.y}`;
  }).join(' ');

  // The sector-median profile (dashed, muted): where the median company in
  // this industry sits on the same five axes.
  const sector = SECTOR_MEDIAN[company.industry];
  const medianPoints = DIMENSIONS.map((_, i) => {
    const p = polar(sector[i + 1], ANGLES[i]);
    return `${p.x},${p.y}`;
  }).join(' ');

  const rings = [0.25, 0.5, 0.75, 1].map((f) =>
    DIMENSIONS.map((_, i) => {
      const p = polar(100, ANGLES[i], RADIUS * f);
      return `${p.x},${p.y}`;
    }).join(' ')
  );

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[220px]" role="img" aria-label="Maturity radar chart">
      {/* Grid */}
      {rings.map((r, i) => (
        <polygon key={i} points={r} fill="none" stroke="#1A1A3A" strokeWidth={1} />
      ))}
      {DIMENSIONS.map((d, i) => {
        const end = polar(100, ANGLES[i]);
        return (
          <line
            key={d.key}
            x1={CENTER}
            y1={CENTER}
            x2={end.x}
            y2={end.y}
            stroke="#1A1A3A"
            strokeWidth={1}
          />
        );
      })}

      {/* Sector-median reference polygon (dashed, muted) */}
      <polygon
        points={medianPoints}
        fill="rgba(107, 107, 138, 0.06)"
        stroke="#6B6B8A"
        strokeWidth={1}
        strokeDasharray="3 3"
        strokeLinejoin="round"
        opacity={0.7}
      />

      {/* Data polygon */}
      <motion.polygon
        points={polygonPoints}
        fill="rgba(0, 217, 192, 0.18)"
        stroke="#00D9C0"
        strokeWidth={2}
        strokeLinejoin="round"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
      {DIMENSIONS.map((d, i) => {
        const p = polar(company.maturity[d.key], ANGLES[i]);
        return <circle key={d.key} cx={p.x} cy={p.y} r={2.5} fill="#00D9C0" />;
      })}

      {/* Center overall score */}
      <text x={CENTER} y={CENTER - 1} textAnchor="middle" fontSize={22} fontWeight={600} fill="#FFFFFF">
        {company.maturity.overall}
      </text>
      <text x={CENTER} y={CENTER + 13} textAnchor="middle" fontSize={7} fill="#6B6B8A">
        / 100
      </text>

      {/* Labels */}
      {DIMENSIONS.map((d, i) => {
        const angle = ANGLES[i];
        const cos = Math.cos(angle);
        const lx = CENTER + (RADIUS + 22) * cos;
        const ly = CENTER + (RADIUS + 22) * Math.sin(angle);
        const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
        return (
          <text
            key={d.key}
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            fontSize={8}
            fill="#6B6B8A"
            className="uppercase tracking-wide"
            style={{ letterSpacing: '0.04em' }}
          >
            {shortLabel(d.label)}
          </text>
        );
      })}
    </svg>
  );
}

function shortLabel(label: string): string {
  if (label === 'Data Infrastructure') return 'Data';
  if (label === 'Workflow Standardization') return 'Workflow';
  if (label === 'AI Deployment') return 'AI';
  return label;
}
