import {
  forceSimulation,
  forceManyBody,
  forceCenter,
  forceLink,
  forceCollide,
  SimulationNodeDatum,
  SimulationLinkDatum,
} from 'd3-force-3d';
import { Company, ConstellationLink } from '@/types';
import { mulberry32, round } from './utils';

interface SimNode extends SimulationNodeDatum {
  id: string;
  constellationId: string;
  industry: string;
  maturity: { overall: number };
  [key: string]: unknown;
}

interface LinkDatum extends SimulationLinkDatum<SimNode> {
  strength: number;
}

/**
 * Build the constellation edge set:
 *  - chain links within each industry group (constellationId = industry)
 *  - a couple of shortcuts per group (Ethiopian-cross style geometry)
 *  - weak links between groups that share an industry (no-op today, since
 *    constellationId IS the industry (kept for future sub-clustering)
 */
export function buildConstellationLinks(nodes: SimNode[]): LinkDatum[] {
  const links: LinkDatum[] = [];

  const byGroup = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    const list = byGroup.get(n.constellationId) ?? [];
    list.push(i);
    byGroup.set(n.constellationId, list);
  });

  byGroup.forEach((indices) => {
    for (let k = 0; k < indices.length - 1; k++) {
      links.push({ source: indices[k], target: indices[k + 1], strength: 0.5 });
    }
    const n = indices.length;
    if (n >= 4) {
      links.push({ source: indices[0], target: indices[Math.floor(n / 2)], strength: 0.4 });
      links.push({ source: indices[Math.floor(n / 3)], target: indices[n - 1], strength: 0.4 });
    }
  });

  const byIndustry = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    const list = byIndustry.get(n.industry) ?? [];
    list.push(i);
    byIndustry.set(n.industry, list);
  });

  byIndustry.forEach((indices) => {
    const reps: number[] = [];
    const seenGroups = new Set<string>();
    for (const i of indices) {
      const cid = nodes[i].constellationId;
      if (!seenGroups.has(cid)) {
        seenGroups.add(cid);
        reps.push(i);
      }
    }
    for (let k = 0; k < reps.length - 1; k++) {
      links.push({ source: reps[k], target: reps[k + 1], strength: 0.15 });
    }
  });

  return links;
}

function resolveNode(link: LinkDatum, nodes: SimNode[]): SimNode {
  return typeof link.source === 'number' ? nodes[link.source] : (link.source as SimNode);
}

function resolveTarget(link: LinkDatum, nodes: SimNode[]): SimNode {
  return typeof link.target === 'number' ? nodes[link.target] : (link.target as SimNode);
}

/**
 * Run the force simulation for 300 ticks, then scale the result into the
 * galaxy sphere. High-maturity companies drift toward the core.
 */
export function computeGalaxyLayout(companies: Company[]): Company[] {
  const nodes = companies.map((c) => ({ ...c })) as unknown as SimNode[];
  const links = buildConstellationLinks(nodes);

  // Deterministic Fibonacci-sphere starting positions (avoids the degenerate
  // all-at-origin start; d3 only seeds nodes whose coords are NaN)
  nodes.forEach((n, i) => {
    const radius = 120 * Math.cbrt(0.5 + i);
    const roll = i * Math.PI * (3 - Math.sqrt(5));
    const yaw = (i * Math.PI * 20) / (9 + Math.sqrt(221));
    n.x = radius * Math.sin(roll) * Math.cos(yaw);
    n.y = radius * Math.cos(roll);
    n.z = radius * Math.sin(roll) * Math.sin(yaw);
  });

  const simulation = forceSimulation<SimNode>(nodes, 3)
    .force('charge', forceManyBody<SimNode>().strength(-70))
    .force('center', forceCenter(0, 0, 0).strength(0.6))
    .force('collision', forceCollide<SimNode>().radius((d) => d.maturity.overall / 20 + 2))
    .force(
      'maturity-repel',
      forceManyBody<SimNode>().strength((d) => (d.maturity.overall > 70 ? -12 : 0))
    )
    .force(
      'link',
      // Numeric link endpoints resolve through the id map, so keep the default
      // `index` accessor (a custom string id would break index lookups)
      forceLink<SimNode, LinkDatum>(links)
        .strength((l) => l.strength)
        .distance((l) =>
          26 + Math.min(resolveNode(l, nodes).maturity.overall, resolveTarget(l, nodes).maturity.overall) / 8
        )
    )
    .stop();

  simulation.randomSource(mulberry32(20260808));

  for (let i = 0; i < 300; i++) simulation.tick();

  const maxR = Math.max(1, ...nodes.map((n) => Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0)));
  const scale = 380 / maxR;

  nodes.forEach((n) => {
    const inward = 1 - (n.maturity.overall / 100) * 0.45;
    n.x = (n.x ?? 0) * scale * inward;
    n.y = (n.y ?? 0) * scale * inward;
    n.z = (n.z ?? 0) * scale * inward;
  });

  return nodes.map((n) => ({
    ...n,
    position: {
      x: round(n.x ?? 0, 2),
      y: round(n.y ?? 0, 2),
      z: round(n.z ?? 0, 2),
    },
  })) as unknown as Company[];
}

/** Pure index-pair links for 3D rendering (client-side, deterministic). */
export function computeConstellationLinks(companies: Company[]): ConstellationLink[] {
  const nodes = companies.map((c) => ({ ...c })) as unknown as SimNode[];
  const links = buildConstellationLinks(nodes);
  return links.map((l) => ({
    source: typeof l.source === 'number' ? l.source : (l.source as unknown as { index?: number }).index ?? 0,
    target: typeof l.target === 'number' ? l.target : (l.target as unknown as { index?: number }).index ?? 0,
  }));
}
