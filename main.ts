// Forecaster for make.fun's GTA VI launch-day Twitch viewers bounty.
//
// The idea, in one paragraph: a launch day has a shape. Hour 1 of a
// rolling-midnight console launch (00:00-01:00 UTC) is quiet — only New
// Zealand and Asia have the game — then viewers dip a little, jump when
// the US unlocks around 05:00 UTC, sag around midday, and peak in the
// evening, hours 17-22 UTC, before fading. How big that rise is depends
// on how big hour 1 already is: a game whose hour 1 is already huge is
// near its peak, while a small hour 1 has headroom to grow several-fold.
// So for each hour h = 2..24 this program fits, over the case's own
// comparables (past big launches, each with its full release day), a
// weighted straight line of log(viewers_h / viewers_1) against
// log(viewers_1), and forecasts from it. Comparables whose unlock was a
// rolling midnight local time — the same unlock GTA VI has — count triple,
// because their shape is the one that applies here. The spread around the
// line is the regression's residual spread, slightly narrowed (x0.9).
//
// What it was checked on: on the four practice launches, fetched from the
// same public source the kit cites, this scores a mean log pinball loss
// of about 0.18, against 0.387 for the house baseline (flat hour 1 with
// a widening spread) and 0.29 for a plain median of the comparables'
// shapes. On leave-one-out over the comparables themselves it scores
// about 0.27, also well under the baseline's 0.36 there. The parameters
// (triple weight for rolling-midnight unlocks, spread x0.9) were picked
// from those two checks, not from any one launch.
//
// The program reads every <id>.in in the input directory and writes one
// <id>.out per case: 23 rows, hours 2..24, five quantiles each at the
// levels 0.05, 0.25, 0.5, 0.75, 0.95. It uses only the standard library,
// no network, no clock, no randomness, so two runs write identical bytes.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
const ROLLING_WEIGHT = 3; // comparables with a rolling midnight-local unlock
const SPREAD_SCALE = 0.9; // residual spread, slightly narrowed
const MIN_HOUR1 = 5000; // ignore comparables whose hour 1 was nearly empty
const MIN_DAY_HOURS = 15; // a usable comparable needs this many release-day hours
const MIN_TRAINING = 6; // fewer points than this and an hour falls back to baseline
const FALLBACK_SIGMA = 0.15; // baseline spread per square-root hour, as the house uses
const MAX_LOG_RATIO = 3.5; // never forecast a rise above ~33x hour 1
const MIN_LOG_RATIO = -2.5; // never forecast a fall below ~0.08x hour 1

type HourlyPoint = { from: string; viewers: number | null; channels?: number | null };
type Comparable = {
  name: string;
  day_start: string;
  unlock: string;
  hourly: HourlyPoint[];
};
type CaseFile = {
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Release-day viewers by hour (1..24) for one comparable, or null if unusable. */
function releaseDay(c: Comparable): Map<number, number> | null {
  if (/before release/i.test(c.name) || /^not a launch/i.test(c.unlock ?? '')) return null;
  const start = Date.parse(c.day_start);
  if (Number.isNaN(start)) return null;
  const byHour = new Map<number, number>();
  for (const p of c.hourly ?? []) {
    if (p.viewers === null || p.viewers === undefined || p.viewers <= 0) continue;
    const t = Date.parse(p.from);
    if (Number.isNaN(t)) continue;
    const h = Math.floor((t - start) / 3_600_000) + 1;
    if (h >= 1 && h <= 24 && !byHour.has(h)) byHour.set(h, p.viewers);
  }
  const h1 = byHour.get(1);
  if (h1 === undefined || h1 < MIN_HOUR1 || byHour.size < MIN_DAY_HOURS) return null;
  return byHour;
}

/** Weighted least squares of y on x; returns [intercept, slope, residual SD]. */
function weightedLine(xs: number[], ys: number[], ws: number[]): [number, number, number] {
  const wSum = ws.reduce((a, b) => a + b, 0);
  const mx = xs.reduce((a, x, i) => a + ws[i] * x, 0) / wSum;
  const my = ys.reduce((a, y, i) => a + ws[i] * y, 0) / wSum;
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += ws[i] * (xs[i] - mx) * (ys[i] - my);
    variance += ws[i] * (xs[i] - mx) * (xs[i] - mx);
  }
  const slope = variance > 0 ? cov / variance : 0;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < xs.length; i++) ss += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const sd = Math.sqrt(ss / xs.length);
  return [intercept, slope, sd];
}

function forecastCase(c: CaseFile): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error('case has no hour-1 print');
  const p1 = Math.max(1, first.viewers);
  const logP1 = Math.log(p1);

  // Training rows: one per usable comparable, with its rolling-midnight weight.
  const rows: Array<{ logP1: number; day: Map<number, number>; weight: number }> = [];
  for (const comp of c.comparables ?? []) {
    const day = releaseDay(comp);
    if (day === null) continue;
    const rolling = /midnight local/i.test(comp.unlock ?? '');
    rows.push({ logP1: Math.log(day.get(1)!), day, weight: rolling ? ROLLING_WEIGHT : 1 });
  }

  return c.forecast.map(({ hour }) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (const r of rows) {
      const v = r.day.get(hour);
      if (v !== undefined) {
        xs.push(r.logP1);
        ys.push(Math.log(v / r.day.get(1)!));
        ws.push(r.weight);
      }
    }
    let q: number[];
    if (xs.length >= MIN_TRAINING) {
      const [a, b, sdRaw] = weightedLine(xs, ys, ws);
      const pred = clamp(a + b * logP1, MIN_LOG_RATIO, MAX_LOG_RATIO);
      const sd = clamp(sdRaw * SPREAD_SCALE, 0.1, 0.8);
      q = Z.map((z) => p1 * Math.exp(pred + z * sd));
    } else {
      // Too little training data for this hour: flat hour 1, house-style spread.
      q = Z.map((z) => p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(hour - 1)));
    }
    // Round, clamp into the allowed range, and keep the quantiles ordered.
    let prev = 1;
    q = q.map((v) => {
      const v2 = clamp(round2(v), 1, 1_000_000_000);
      const v3 = Math.max(v2, prev);
      prev = v3;
      return v3;
    });
    return { hour, q };
  });
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const hours = forecastCase(c);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
