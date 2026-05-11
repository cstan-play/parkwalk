import type { SmellType } from '@parkwalk/shared';

export type TimeOfDayBucket = 'morning' | 'midday' | 'evening' | 'night';

export interface DescribeWalkSmellsInput {
  /** Smell-type counts. Either built from a local walk's collectedSmells or
   *  taken straight from the server-derived walk.smells.byType. */
  byType: Partial<Record<SmellType, number>>;
  /** The weather string from the walk record, or null if unavailable. */
  weather: string | null;
  timeOfDay: TimeOfDayBucket;
  dayOfWeek?: string;
  /** A stable per-walk seed (typically walk.clientId) so re-opening the same
   *  walk renders the identical flavor list. */
  walkSeed: string;
}

export interface DescribeWalkSmellsOutput {
  headline: string;
  lines: string[];
}

/**
 * Builds a short, Gus-voiced rundown of the smells found on a walk. Pure;
 * deterministic on `walkSeed`. The smell *types* and *counts* come from
 * real data — only the wording around them is generated.
 */
export function describeWalkSmells(input: DescribeWalkSmellsInput): DescribeWalkSmellsOutput {
  const rng = createSeededRng(input.walkSeed);
  const sorted = sortedEntries(input.byType);
  const total = sorted.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) {
    return {
      headline: pickFrom(EMPTY_HEADLINES, rng),
      lines: [],
    };
  }

  const headline = formatHeadline(total, input.timeOfDay, rng);
  const weatherMood = weatherToMood(input.weather);
  const lines = sorted
    .slice(0, 6)
    .map(([type, count]) => renderLine(type, count, weatherMood, input.timeOfDay, rng));
  return { headline, lines };
}

// ---- internals ----

function sortedEntries(
  byType: Partial<Record<SmellType, number>>,
): Array<[SmellType, number]> {
  const entries = Object.entries(byType) as Array<[SmellType, number | undefined]>;
  return entries
    .filter((entry): entry is [SmellType, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .sort((a, b) => b[1] - a[1]);
}

const EMPTY_HEADLINES = [
  'No new intel this time. Quiet walk.',
  'Nothing to report. Lampposts were stale.',
  'Empty haul. The hedge let me down.',
];

function formatHeadline(total: number, time: TimeOfDayBucket, rng: () => number): string {
  const tail = time === 'morning' ? ' Pre-coffee material.' :
               time === 'midday' ? ' Middle-of-the-day intel.' :
               time === 'evening' ? ' Solid evening haul.' :
               ' Quiet, late, the good stuff.';
  const noun = total === 1 ? 'find' : 'finds';
  const verb = total >= 6 ? 'Stacked' : total >= 3 ? 'Decent' : 'Modest';
  const variants = [
    `${verb} walk. ${total} ${noun}.${tail}`,
    `${total} ${noun} catalogued.${tail}`,
    `${verb}. ${total} ${noun} in the bag.${tail}`,
  ];
  return pickFrom(variants, rng);
}

type WeatherMood = 'rain' | 'cold' | 'warm' | 'neutral';

function weatherToMood(weather: string | null): WeatherMood {
  if (!weather) return 'neutral';
  const lower = weather.toLowerCase();
  if (/(rain|drizzle|shower)/.test(lower)) return 'rain';
  // Pull a numeric temperature like "8°C" if present.
  const tempMatch = lower.match(/(-?\d+)\s*°c/);
  if (tempMatch) {
    const temp = parseInt(tempMatch[1]!, 10);
    if (temp <= 5) return 'cold';
    if (temp >= 22) return 'warm';
  }
  return 'neutral';
}

type LineContext = {
  count: number;
  weather: WeatherMood;
  time: TimeOfDayBucket;
};

const TEMPLATES: Record<SmellType, Array<(c: LineContext) => string>> = {
  pigeons: [
    (c) => `Pigeons: ${c.count}. ${c.weather === 'warm' ? 'Heavy traffic today.' : 'Loitering with intent.'}`,
    (c) => `${c.count} pigeons logged. They saw me. They knew.`,
    (c) =>
      c.time === 'morning'
        ? `Pigeons (${c.count}). Already on the clock.`
        : `Pigeons (${c.count}). Still smug about the bread situation.`,
    (c) => `${c.count} pigeon${c.count === 1 ? '' : 's'}. Same neighborhood, same union.`,
  ],
  birds: [
    (c) => `Birds: ${c.count}. ${c.weather === 'cold' ? 'Tracks crisp from the chill.' : 'Standard rotation.'}`,
    (c) => `Bird news x${c.count}. Probably the same blackbird, twice.`,
    (c) =>
      c.time === 'evening'
        ? `${c.count} bird passes. Roosting hour.`
        : `${c.count} bird passes. Suspiciously polite.`,
    (c) => `Birds (${c.count}). Mid-tier intel but pleasant.`,
  ],
  real_poop: [
    (c) =>
      c.count === 1
        ? 'One uncollected gift. Someone is going to hell.'
        : `${c.count} uncollected gifts. The neighborhood owes me an apology.`,
    (c) => `Untouched offerings: ${c.count}. ${c.weather === 'rain' ? 'Wet and louder than usual.' : 'Pungent.'}`,
    () => `Real poop, plural. I will not name names. (yet.)`,
  ],
  picked_up_poop: [
    (c) => `Civilization markers: ${c.count}. Bags actually used. Faith partially restored.`,
    (c) => `${c.count} picked-up specimen${c.count === 1 ? '' : 's'}. Someone read the rules.`,
    () => `Cleaned-up poop. The good kind of evidence.`,
  ],
  humans: [
    (c) =>
      c.time === 'evening'
        ? `Humans, ${c.count}. Commuter shift. Yours among them, probably.`
        : `Humans, ${c.count}. ${c.weather === 'cold' ? 'Wrapped tight and ignoring me.' : 'Yours among them, I assume.'}`,
    (c) => `${c.count} human readings. Most uninteresting. Sorry.`,
    () => `Humans noted. As ever, you smell the best.`,
  ],
  neighbours: [
    (c) =>
      c.time === 'morning'
        ? `${c.count} neighbour${c.count === 1 ? '' : 's'}. Overnight signal still warm.`
        : `${c.count} neighbour${c.count === 1 ? '' : 's'}. The usual suspects.`,
    (c) => `Neighbour intel x${c.count}. Mrs. so-and-so still hasn't washed the doormat.`,
    () => `Neighbours logged. Filed under "tolerated".`,
  ],
  other_dogs_pee: [
    (c) => `${c.count} other-dog markings. The corner lamppost is a chatroom.`,
    (c) =>
      c.weather === 'rain'
        ? `Dog notes (${c.count}). Louder when wet. Excellent rain.`
        : `Dog notes (${c.count}). Catching up on three days of gossip.`,
    () => `Other dogs were here. As I suspected. The terrier never rests.`,
  ],
};

function renderLine(
  type: SmellType,
  count: number,
  weather: WeatherMood,
  time: TimeOfDayBucket,
  rng: () => number,
): string {
  const pool = TEMPLATES[type];
  const choose = pickFrom(pool, rng);
  return choose({ count, weather, time });
}

// ---- seeded RNG ----

function pickFrom<T>(pool: T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)] ?? pool[0]!;
}

/** Mulberry32 — small, fast, plenty random for flavor variation. */
function createSeededRng(seed: string): () => number {
  let state = hashStringToInt(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToInt(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
