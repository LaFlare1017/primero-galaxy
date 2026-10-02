/**
 * Mulberry32 seeded PRNG.
 *
 * The entire seed pipeline must be deterministic: a fixed seed produces the
 * byte-identical company, defect placement included (handoff §3.3). Every
 * generator draws randomness exclusively through this class — no Math.random
 * anywhere in the seed path.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) {
      throw new Error(`SeededRng requires a finite numeric seed, got ${seed}`);
    }
    this.state = seed >>> 0;
  }

  /** Next uint32 in [0, 2^32). */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  intInclusive(min: number, max: number): number {
    if (max < min) throw new Error(`intInclusive: max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform integer in [min, max) exclusive. */
  intExclusive(min: number, max: number): number {
    if (max <= min) throw new Error(`intExclusive: max ${max} <= min ${min}`);
    return min + Math.floor(this.next() * (max - min));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick: empty array");
    return items[this.intExclusive(0, items.length)] as T;
  }

  /** Weighted pick; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length === 0 || items.length !== weights.length) {
      throw new Error("weighted: items/weights length mismatch");
    }
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i] as number;
      if (roll < 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }
}
