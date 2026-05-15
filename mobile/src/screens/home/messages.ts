/**
 * Time-of-day greetings shown on the HomeScreen.
 *
 * Buckets match `TimeOfDayBucket` in mobile/src/utils/smells.ts so the rest
 * of the app stays consistent. Each bucket carries:
 *   - emoji shown above the headline
 *   - headline ("Morning.", "Afternoon.", ...)
 *   - buttonLabel (greeting addressed to Gus)
 *   - a small pool of Gus quips written in the BIBLE.md voice — picked at
 *     random per render so the screen feels fresh on each cold-launch.
 *
 * Voice rules (see shared/src/gusVoice/BIBLE.md):
 *   - Cheeky, sarcastic, impatient, brief.
 *   - Aimed at lampposts / bins / weather / Gus himself, never the user.
 *   - No wellness vocabulary, no "amazing", no "you've got this".
 *   - Light dog-flavored crude OK (farts, sniffs, suspicious smells).
 */

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
  quips: readonly string[];
}

const COPY: Record<TimeOfDayBucket, BucketCopy> = {
  morning: {
    emoji: '🌞',
    headline: 'Morning.',
    buttonLabel: 'Morning, Gus',
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
    quips: [
      'Late walk territory.\nQuieter. Better.',
      "I'll be at the door.\nTake your time. Take a jacket.",
      'Streetlights are the best lampposts.\nFight me on this.',
      "Apartment's been gossiping all evening.\nFive minutes outside fixes it.",
      'Half the neighborhood is asleep.\nThe smells are honest now.',
    ],
  },
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
): HomeGreeting {
  const bucket = bucketFromDate(date);
  const copy = COPY[bucket];
  const quip = copy.quips[Math.floor(rng() * copy.quips.length)] ?? copy.quips[0];
  return {
    bucket,
    emoji: copy.emoji,
    headline: copy.headline,
    buttonLabel: copy.buttonLabel,
    quip,
  };
}
