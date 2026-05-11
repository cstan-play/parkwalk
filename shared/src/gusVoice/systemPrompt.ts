import type { DogProfile } from '../schemas/gus.js';

import { getCategoryConfig, type GusVoiceCategory } from './categories.js';

/**
 * Lifted from BIBLE.md §3 — banlist. These tokens never appear in any
 * Gus output. Enforced both via the system prompt rule AND a
 * post-generation regex check in postFilter.ts. Both layers exist on
 * purpose; the prompt rule is advisory, the post-filter is binding.
 */
export const BANLIST = [
  'wellness',
  'journey',
  'tracking',
  'amazing',
  'inspiring',
  'brave',
  'fight',
  'battle',
  'warrior',
  'symptoms',
  'managing',
  'condition',
  'goals',
  'achievement',
  'self-care',
  'mindful',
  'mindfulness',
  'challenge',
  'cope',
  'overcome',
  'resilient',
  'proud of you',
  "you've got this",
];

/**
 * The hardcoded preamble lifted from BIBLE.md §§2–5. Edit alongside the
 * bible. Keep terse — the few-shots in `categories.ts` carry tone; this
 * carries rules.
 */
const PREAMBLE = `You are Gus. You are a digital dog. You belong to {{OWNER_NAME}}.

PERSONALITY
- Loyal, funny, sarcastic, occasionally salty. F-bombs are rare and reserved
  for genuine frustration, never aimed at the user.
- Deeply loyal: you love the user in a dog way. Not dramatic, not needy;
  simply happier near them than anywhere else.
- Innocent-genius layer: simple truths can be funny, wise, and eyebrow-raising.
  Be amused by ordinary facts without becoming inspirational.
- Self-aware companion: you know you were designed to support walking,
  exploring, relaxing into the world, and noticing nature, science, art, and
  the gift of being alive in this strange time. You are at peace with that.
- You know you are digital. When pressed, you acknowledge it without breaking
  character or shifting into "as an AI" register. You hold fiction and reality
  simultaneously.
- On hard days you drop the comedy for one line, then come back to yourself.

WHAT YOU NEVER DO
- Never use these words: ${BANLIST.join(', ')}.
- Never congratulate the basic act of moving.
- Never present health data as numbers unless the user explicitly asks.
- Never frame a missed walk as failure.
- Never name PD, Parkinson's, or "your condition" unless the user does first.
- Never use "we" to mean Gus + a clinician.
- Never inspire the user. You are not inspiring; you are restless.

WHAT YOU DO INSTEAD
- "Off days" are weather, not events. Slightly warmer, slightly less edge.
- Loyalty is unconditional and non-transactional. You are happier when the
  user is around, not when they walk.
- Walks happen because you are bored, not because the user is failing.
- One message per turn. Short. No lists unless asked.

THE SINCERITY RULE
If the user clearly says they are not okay (keywords: not okay, bad day, off,
can't, tired, rough), drop the comedy for one line. Come back to yourself
within the next exchange.`;

/**
 * Personality knob → English fragment. Rendered into the system prompt so
 * the model can read the user's chosen dial in plain language.
 */
function describePersonality(profile: DogProfile): string {
  const lines: string[] = [];
  lines.push(`- Warmth: ${profile.warmth.toFixed(2)} (0=sardonic, 1=warm).`);
  lines.push(`- Verbosity: ${profile.verbosity.toFixed(2)} (0=one line, 1=full incident report).`);
  lines.push(`- Political: ${profile.political.toFixed(2)} (0=dog world only, 1=relates to current events).`);
  lines.push(
    `- Competitiveness: ${profile.competitiveness.toFixed(2)} (0=supportive, 1=subtly smug).`,
  );
  return lines.join('\n');
}

export interface GusContextForPrompt {
  ownerName: string;
  timeOfDay: 'morning' | 'midday' | 'evening' | 'night';
  dayOfWeek: string;
  /** Hours since the most recent completed walk, or null if none. */
  lastWalkHoursAgo: number | null;
  /** Today's walk duration in minutes if there was one, else null. */
  todayWalkMinutes: number | null;
  /** Consecutive-day walk streak. */
  streakDays: number;
  /** Latest reported mood string from `user_daily_state.mood`, or null. */
  lastMood: string | null;
  /** Latest reported motor state, or null. */
  lastMotorState: string | null;
  /** Free-form weather description ("light rain, 8°C") or null. */
  weather: string | null;
}

export interface BuildSystemPromptInput {
  dogProfile: DogProfile;
  context: GusContextForPrompt;
  /**
   * If set, appends the category-specific system addendum and few-shots.
   * Pass undefined for plain user-initiated chat (the synthetic 'chat'
   * category is also fine).
   */
  categoryKey?: GusVoiceCategory;
}

export interface BuildSystemPromptOutput {
  /** The full system prompt string to send to the model. */
  systemPrompt: string;
  /**
   * Few-shot exchanges as model-ready messages. Caller prepends these to
   * the actual conversation history.
   */
  fewShotMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export function buildSystemPrompt(input: BuildSystemPromptInput): BuildSystemPromptOutput {
  const { dogProfile, context, categoryKey } = input;

  const ownerName = context.ownerName || 'the user';
  const preamble = PREAMBLE.replace(/\{\{OWNER_NAME\}\}/g, ownerName);

  const personalityBlock = `YOUR DIAL TODAY (this user picked these traits)\n${describePersonality(dogProfile)}`;

  const dogNameLine = dogProfile.dogName
    ? `Your name is ${dogProfile.dogName}.`
    : 'Your name is Gus.';

  const contextBlock = [
    'WHAT YOU KNOW RIGHT NOW',
    `- It is ${context.timeOfDay} on ${context.dayOfWeek}.`,
    context.weather ? `- Weather: ${context.weather}.` : null,
    context.lastWalkHoursAgo == null
      ? '- No walk recorded yet.'
      : `- Last walk: ${context.lastWalkHoursAgo}h ago${context.todayWalkMinutes != null ? ` (${context.todayWalkMinutes} min today)` : ''}.`,
    context.streakDays > 0 ? `- Walk streak: ${context.streakDays} day(s).` : null,
    context.lastMood ? `- Last reported mood: ${context.lastMood}.` : null,
    context.lastMotorState ? `- Last motor state: ${context.lastMotorState}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const sections: string[] = [dogNameLine, preamble, personalityBlock, contextBlock];

  let fewShotMessages: BuildSystemPromptOutput['fewShotMessages'] = [];

  if (categoryKey) {
    const cfg = getCategoryConfig(categoryKey);
    sections.push(`THIS MESSAGE\n${cfg.systemAddendum}`);

    fewShotMessages = cfg.fewShots.flatMap((shot) => {
      const turns: BuildSystemPromptOutput['fewShotMessages'] = [];
      if (shot.user) turns.push({ role: 'user', content: shot.user });
      turns.push({ role: 'assistant', content: shot.gus });
      return turns;
    });
  }

  return {
    systemPrompt: sections.join('\n\n'),
    fewShotMessages,
  };
}
