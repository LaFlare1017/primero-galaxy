// Minimal ambient typings for d3-force-3d (v3 ships no bundled types and
// @types/d3-force-3d does not exist on npm). Covers only the API surface
// used by lib/galaxy-layout.ts.

declare module 'd3-force-3d' {
  export interface SimulationNodeDatum {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface Simulation<NodeDatum extends SimulationNodeDatum> {
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
    tick(iterations?: number): this;
    stop(): this;
    force(name: string, force: Force<NodeDatum> | null): this;
    alpha(value: number): this;
    randomSource(source: () => number): this;
  }

  export interface Force<NodeDatum extends SimulationNodeDatum> {
    (alpha: number): void;
    initialize?(nodes: NodeDatum[], random: () => number): void;
  }

  export interface SimulationLinkDatum<NodeDatum extends SimulationNodeDatum> {
    source: number | string | NodeDatum;
    target: number | string | NodeDatum;
  }

  export function forceSimulation<NodeDatum extends SimulationNodeDatum>(
    nodes?: NodeDatum[],
    numDimensions?: number
  ): Simulation<NodeDatum>;

  export interface ManyBodyForce<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum> {
    strength(strength: number | ((d: NodeDatum) => number)): this;
    distanceMin(min: number): this;
    distanceMax(max: number): this;
  }
  export function forceManyBody<NodeDatum extends SimulationNodeDatum>(): ManyBodyForce<NodeDatum>;

  export interface CenterForce<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum> {
    x(x: number): this;
    y(y: number): this;
    z(z: number): this;
    strength(strength: number): this;
  }
  export function forceCenter<NodeDatum extends SimulationNodeDatum>(
    x?: number,
    y?: number,
    z?: number
  ): CenterForce<NodeDatum>;

  export interface ForceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum> = SimulationLinkDatum<NodeDatum>
  > extends Force<NodeDatum> {
    links(): LinkDatum[];
    links(links: LinkDatum[]): this;
    id(id: (d: NodeDatum) => string): this;
    strength(strength: number | ((link: LinkDatum) => number)): this;
    distance(distance: number | ((link: LinkDatum) => number)): this;
  }
  export function forceLink<
    NodeDatum extends SimulationNodeDatum,
    LinkDatum extends SimulationLinkDatum<NodeDatum> = SimulationLinkDatum<NodeDatum>
  >(links?: LinkDatum[]): ForceLink<NodeDatum, LinkDatum>;

  export interface CollideForce<NodeDatum extends SimulationNodeDatum> extends Force<NodeDatum> {
    radius(radius: number | ((d: NodeDatum) => number)): this;
    strength(strength: number): this;
    iterations(iterations: number): this;
  }
  export function forceCollide<NodeDatum extends SimulationNodeDatum>(
    radius?: number | ((d: NodeDatum) => number)
  ): CollideForce<NodeDatum>;
}
