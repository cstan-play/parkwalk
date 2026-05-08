import {
  applyPostFilter,
  buildSystemPrompt,
  FALLBACK_REPLIES,
  findBanlistHits,
  getCategoryConfig,
  type DogProfile,
  type GusContextForPrompt,
  type GusModel,
  type SwearingCeiling,
} from '@parkwalk/shared';

import { env } from '../../env.js';
import { logger } from '../../logger.js';

export interface VoiceConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateInput {
  dogProfile: DogProfile;
  context: GusContextForPrompt;
  history: VoiceConversationTurn[];
  /**
   * Set when this is a notification-triggered message. Plain user chat
   * passes 'chat' (or omits — we default to 'chat').
   */
  categoryKey?: 'chat' | 'morning_check_in' | 'walk_reminder' | 'post_walk_debrief';
  /**
   * If the user just sent a message, include it here so it becomes the
   * final user turn. Notification-fire calls leave this undefined.
   */
  userMessage?: string;
  swearingCeiling: SwearingCeiling;
}

export interface GenerateOutput {
  content: string;
  modelUsed: GusModel | 'fallback';
}

/**
 * Lazy-loaded Anthropic SDK. Held in a module-scoped promise so we only
 * import once per process. Returns null if the SDK isn't installed yet
 * (so the routes can boot without `npm install`).
 */
let anthropicLoader: Promise<unknown | null> | null = null;
function loadAnthropic(): Promise<unknown | null> {
  if (anthropicLoader) return anthropicLoader;
  anthropicLoader = (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      const mod = (await import('@anthropic-ai/sdk')) as {
        default: new (opts: { apiKey: string }) => unknown;
      };
      return new mod.default({ apiKey: env.ANTHROPIC_API_KEY ?? '' });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Anthropic SDK not loadable — Gus voice will return fallback strings',
      );
      return null;
    }
  })();
  return anthropicLoader;
}

export async function generate(input: GenerateInput): Promise<GenerateOutput> {
  const categoryKey = input.categoryKey ?? 'chat';
  const cfg = getCategoryConfig(categoryKey);

  // No key set — short-circuit to a fallback. Useful before deps and key
  // are wired; lets the rest of the stack be smoke-tested.
  if (!env.ANTHROPIC_API_KEY) {
    return {
      content:
        categoryKey in FALLBACK_REPLIES
          ? FALLBACK_REPLIES[categoryKey as keyof typeof FALLBACK_REPLIES]
          : FALLBACK_REPLIES.generic,
      modelUsed: 'fallback',
    };
  }

  const anthropic = (await loadAnthropic()) as null | {
    messages: {
      create: (args: unknown) => Promise<{
        content: Array<{ type: string; text?: string }>;
      }>;
    };
  };
  if (!anthropic) {
    return { content: FALLBACK_REPLIES.generic, modelUsed: 'fallback' };
  }

  const { systemPrompt, fewShotMessages } = buildSystemPrompt({
    dogProfile: input.dogProfile,
    context: input.context,
    categoryKey,
  });

  const messages = [
    ...fewShotMessages,
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
  ];
  if (input.userMessage) {
    messages.push({ role: 'user', content: input.userMessage });
  }
  if (messages.length === 0) {
    // Notification-fire calls with no history — give the model a hook to
    // produce the opening line for this category.
    messages.push({ role: 'user', content: '[system: produce the opening line for this category]' });
  }

  const callOnce = async (extraSystem?: string): Promise<string> => {
    const fullSystem = extraSystem ? `${systemPrompt}\n\n${extraSystem}` : systemPrompt;
    const response = await anthropic.messages.create({
      model: cfg.model,
      max_tokens: 320,
      system: fullSystem,
      messages,
    });
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
      .trim();
    return text;
  };

  let raw: string;
  try {
    raw = await callOnce();
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, category: categoryKey },
      'Anthropic call failed — using fallback',
    );
    return {
      content:
        categoryKey in FALLBACK_REPLIES
          ? FALLBACK_REPLIES[categoryKey as keyof typeof FALLBACK_REPLIES]
          : FALLBACK_REPLIES.generic,
      modelUsed: 'fallback',
    };
  }

  // Banlist policy: regenerate once with stricter system; if still hit,
  // fall back to a stock line.
  let hits = findBanlistHits(raw);
  if (hits.length > 0) {
    logger.info({ hits, category: categoryKey }, 'Banlist hit on first generation; retrying');
    try {
      raw = await callOnce(
        `STRICT MODE: the previous attempt used these banned words: ${hits.join(', ')}. Do not use them. Try again.`,
      );
    } catch {
      raw = '';
    }
    hits = findBanlistHits(raw);
  }
  if (hits.length > 0 || !raw) {
    return {
      content:
        categoryKey in FALLBACK_REPLIES
          ? FALLBACK_REPLIES[categoryKey as keyof typeof FALLBACK_REPLIES]
          : FALLBACK_REPLIES.generic,
      modelUsed: 'fallback',
    };
  }

  const filtered = applyPostFilter(raw, input.swearingCeiling);
  return { content: filtered.text, modelUsed: cfg.model };
}
