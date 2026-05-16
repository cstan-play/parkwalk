/**
 * Time-of-day greetings shown on the HomeScreen, optionally flavored by
 * current weather.
 *
 * Buckets match `TimeOfDayBucket` in mobile/src/utils/smells.ts so the rest
 * of the app stays consistent. Each time-of-day bucket carries:
 *   - emoji shown above the headline (fallback when no live weather is yet
 *     available — weather emoji takes precedence)
 *   - headline ("Morning.", "Afternoon.", ...)
 *   - buttonLabel base (e.g. "Morning, Gus"); a weather adjective is
 *     prepended when weather is known.
 *   - a small pool of time-of-day quips written in the BIBLE.md voice.
 *
 * When a WMO weather_code is passed to `pickHomeGreeting`, the function
 * also pulls from a weather-flavored quip pool and biases selection toward
 * it, so a rainy afternoon doesn't get the same sunny-day quip as a clear
 * one. The weather emoji from `weatherIcon.ts` overrides the time-of-day
 * emoji.
 *
 * Voice rules (see shared/src/gusVoice/BIBLE.md):
 *   - Cheeky, sarcastic, impatient, brief.
 *   - Aimed at lampposts / bins / weather / Gus himself, never the user.
 *   - No wellness vocabulary, no "amazing", no "you've got this".
 *   - Light dog-flavored crude OK (farts, sniffs, suspicious smells).
 */

import { weatherCodeToEmoji } from '@/util/weatherIcon';
import type { TimeOfDayBucket } from '@/utils/smells';

export interface HomeGreeting {
  bucket: TimeOfDayBucket;
  emoji: string;
  headline: string;
  buttonLabel: string;
  quip: string;
}

interface BucketCopy {
  emoji: string;
  headline: string;
  buttonLabel: string;
  /** Lowercased noun used when composing weather-flavored button labels:
   *  "{Adjective} {timeWord}, Gus" — e.g. "Wet morning, Gus". */
  timeWord: string;
  quips: readonly string[];
}

const COPY: Record<TimeOfDayBucket, BucketCopy> = {
  morning: {
    emoji: '🌞',
    headline: 'Morning.',
    buttonLabel: 'Morning, Gus',
    timeWord: 'morning',
    quips: [
      'I had a dream about a sandwich.\nAre we walking today?',
      "The bin is plotting again.\nWalk first, I'll explain on the way.",
      "I've been awake since five.\nPatience running thin.",
      "I've already farted twice and licked something I shouldn't.\nLet's get out before the day gets worse.",
      "Lampposts won't read themselves.\nReady when you are.",
    ],
  },
  midday: {
    emoji: '☀️',
    headline: 'Afternoon.',
    buttonLabel: 'Afternoon, Gus',
    timeWord: 'afternoon',
    quips: [
      'The neighborhood is moving without us.\nAnnoying.',
      "Sun's up, lampposts are warm.\nMidday news cycle is the best one.",
      'I sniffed something earlier I want to revisit.\nDetails on location.',
      "You're sitting and I'm staring at you.\nWe both know what's next.",
      'The bakery has been releasing smells since ten.\nWe owe ourselves a loop.',
    ],
  },
  evening: {
    emoji: '🌇',
    headline: 'Evening.',
    buttonLabel: 'Evening, Gus',
    timeWord: 'evening',
    quips: [
      "Day's cooling off.\nGood sniffing weather.",
      "You worked through lunch.\nThe canal will fix that.",
      "There's still light.\nLet's use it before someone notices.",
      'Streetlights coming on soon.\nThose count as lampposts too, by the way.',
      "I'm pacing again.\nI'm not subtle about it.",
    ],
  },
  night: {
    emoji: '🌙',
    headline: 'Night.',
    buttonLabel: 'Hey, Gus',
    timeWord: 'night',
    quips: [
      'Late walk territory.\nQuieter. Better.',
      "I'll be at the door.\nTake your time. Take a jacket.",
      'Streetlights are the best lampposts.\nFight me on this.',
      "Apartment's been gossiping all evening.\nFive minutes outside fixes it.",
      'Half the neighborhood is asleep.\nThe smells are honest now.',
    ],
  },
};

export type WeatherFlavor =
  | 'clear'
  | 'cloudy'
  | 'overcast'
  | 'foggy'
  | 'drizzle'
  | 'rain'
  | 'heavy_rain'
  | 'snow'
  | 'storm';

/**
 * Maps Open-Meteo WMO weather_code → narrative flavor used to pick quips
 * and a button-label adjective. See the same code table used by the
 * backend formatter in `backend/src/services/weather.ts`.
 */
function weatherFlavorFromCode(code: number | null | undefined): WeatherFlavor | null {
  if (code === null || code === undefined || !Number.isFinite(code)) return null;
  if (code === 0) return 'clear';
  if (code <= 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 63) return 'rain';
  if (code === 65) return 'heavy_rain';
  if (code === 66 || code === 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 81) return 'rain';
  if (code === 82) return 'heavy_rain';
  if (code === 85 || code === 86) return 'snow';
  if (code === 95 || code === 96 || code === 99) return 'storm';
  return null;
}

const WEATHER_ADJECTIVE: Record<WeatherFlavor, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  overcast: 'Grey',
  foggy: 'Foggy',
  drizzle: 'Drizzly',
  rain: 'Wet',
  heavy_rain: 'Wet',
  snow: 'Snowy',
  storm: 'Stormy',
};

const WEATHER_QUIPS: Record<WeatherFlavor, readonly string[]> = {
  clear: [
    "Sun's doing its annual one good day.\nLampposts at peak warmth.",
    "Bright out. Pigeons feel important.\nI'd like to interrupt them.",
    'Clear sky. Excellent sniff conditions.\nWe should not waste this.',
    'No clouds, no excuses.\nThe canal is waiting.',
  ],
  cloudy: [
    'Soft grey, calm streets.\nGood walk weather without ceremony.',
    'Clouds making the rounds.\nThe canal looks moody. Let us go look.',
    "Mild sky. Mild plans.\nLet's not overthink it.",
  ],
  overcast: [
    'Grey all the way down.\nWalking weather without ego.',
    'Sky is doing nothing special.\nWe can match that energy outside.',
    "Flat light, honest smells.\nUnderrated combination.",
  ],
  foggy: [
    "Fog. Mysterious.\nWe'll pretend it means something.",
    'Visibility is poor and that is the point.\nThe smells get loud.',
    "Soft world out there.\nLampposts appear like ghosts. I'm into it.",
  ],
  drizzle: [
    'Drizzle. Barely a thing.\nUmbrella optional. Lamppost news mandatory.',
    'Soft rain, the good kind.\nSmells are amplified. Trust me.',
    'Damp air, decent walk.\nNo one will judge a short one.',
  ],
  rain: [
    "It's raining.\nI'm asking anyway. Short loop counts.",
    "Wet out. I know.\nThe smells are louder in the rain. Twenty minutes.",
    "Rain doesn't read lampposts.\nThat's our job. Still on.",
  ],
  heavy_rain: [
    "It's properly raining.\nWe don't have to. But I'd remember if we did.",
    'Heavy stuff out there.\nA quick door-and-back also counts as a walk.',
    "Water everywhere.\nWe stay in if you want. I won't make it weird.",
  ],
  snow: [
    'Snow. My pads have opinions.\nA loop and we are home for biscuits.',
    "Quiet world.\nNot a single squirrel making bad decisions out there. Yet.",
    "Cold and white.\nGood for short, dramatic walks.",
  ],
  storm: [
    'Thunder out there.\nWe are not heroes. Window inspection is also walking.',
    'Loud sky.\nI vote staying in. I rarely vote for anything.',
    'Storm in progress.\nThe lampposts will still be there tomorrow.',
  ],
};

export function bucketFromDate(date: Date = new Date()): TimeOfDayBucket {
  const h = Number.isFinite(date.getHours()) ? date.getHours() : 12;
  if (h < 5) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'midday';
  if (h < 22) return 'evening';
  return 'night';
}

export function pickHomeGreeting(
  date: Date = new Date(),
  rng: () => number = Math.random,
  weatherCode: number | null | undefined = null,
): HomeGreeting {
  const bucket = bucketFromDate(date);
  const copy = COPY[bucket];
  const flavor = weatherFlavorFromCode(weatherCode);

  // When weather is known, bias quip selection 2:1 toward weather-flavored
  // lines by duplicating the weather pool — this is the cheapest way to
  // weight without changing the pick algorithm. With ~3 weather lines and
  // ~5 time-of-day lines, weather wins ~55-60% of the time.
  const weatherQuips = flavor ? WEATHER_QUIPS[flavor] : null;
  const pool = weatherQuips
    ? [...weatherQuips, ...weatherQuips, ...copy.quips]
    : [...copy.quips];
  const quip = pool[Math.floor(rng() * pool.length)] ?? copy.quips[0];

  const emoji = flavor ? weatherCodeToEmoji(weatherCode, { now: date }) : copy.emoji;
  const buttonLabel = flavor
    ? `${WEATHER_ADJECTIVE[flavor]} ${copy.timeWord}, Gus`
    : copy.buttonLabel;

  return {
    bucket,
    emoji,
    headline: copy.headline,
    buttonLabel,
    quip,
  };
}
