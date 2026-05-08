import type { SwearingCeiling } from '../schemas/gus.js';

import { BANLIST } from './systemPrompt.js';

/**
 * Slurs that get stripped unconditionally regardless of swearing ceiling.
 * Add new entries lowercase, no punctuation.
 *
 * Deliberately not including the banlist words here — those trigger a
 * regenerate-or-fallback flow upstream, not silent stripping.
 */
const HARD_SLUR_BANLIST: string[] = [
  // [Catalin: extend if specific words come up]
];

export interface PostFilterResult {
  /** The cleaned text. May be identical to input. */
  text: string;
  /**
   * If non-empty, the upstream caller should regenerate with a stricter
   * system prompt and try again. Each entry is one banlist hit.
   */
  banlistHits: string[];
  /**
   * True if the filter modified the text at all (slurs stripped, f-bombs
   * scrubbed for a "mild" ceiling, etc.).
   */
  modified: boolean;
}

/**
 * Apply the runtime guardrails to a freshly-generated Gus message.
 *
 * 1. Banlist check — if any banlist word appears, return hits to upstream.
 *    Upstream is responsible for the regenerate-once-then-fallback policy.
 * 2. Slur strip — unconditional.
 * 3. Swearing ceiling — strip f-bombs if `ceiling === 'mild'`; strip all
 *    swearing if `ceiling === 'off'`.
 */
export function applyPostFilter(input: string, ceiling: SwearingCeiling): PostFilterResult {
  let text = input;
  let modified = false;

  const banlistHits = findBanlistHits(text);

  for (const slur of HARD_SLUR_BANLIST) {
    const re = new RegExp(`\\b${escapeRegex(slur)}\\b`, 'gi');
    if (re.test(text)) {
      text = text.replace(re, '[redacted]');
      modified = true;
    }
  }

  if (ceiling !== 'full') {
    const fbomb = /\bf+u+c+k+(?:ing|ed|er|s)?\b/gi;
    if (fbomb.test(text)) {
      text = text.replace(fbomb, 'damn');
      modified = true;
    }
  }
  if (ceiling === 'off') {
    const moreSwears = /\b(shit|hell|ass|bastard|bullshit)\b/gi;
    if (moreSwears.test(text)) {
      text = text.replace(moreSwears, '');
      text = text.replace(/\s{2,}/g, ' ').trim();
      modified = true;
    }
  }

  return { text, banlistHits, modified };
}

export function findBanlistHits(text: string): string[] {
  const hits: string[] = [];
  for (const word of BANLIST) {
    const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
    if (re.test(text)) hits.push(word);
  }
  return hits;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Last-resort fallback when the model can't produce a banlist-clean reply
 * after a regenerate attempt. Hand-written, on-brand, deliberately
 * minimal. The chat thread shows this; nobody dies.
 */
export const FALLBACK_REPLIES = {
  generic: "Brain's not working right now. Try me again.",
  morning_check_in: 'Up. Now. — Gus',
  walk_reminder: "Door. Now. — Gus",
  post_walk_debrief: 'Good. Done. Water me.',
} as const;
