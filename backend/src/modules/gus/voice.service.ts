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
  modelOverride?: string | null;
}

export interface GenerateOutput {
  content: string;
  modelUsed: string;
}

type GusProvider = 'xai' | 'anthropic' | 'fallback';

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
  const provider = resolveGusProvider();
  const model = input.modelOverride?.trim() || configuredModelForCategory(categoryKey);

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

  if (provider === 'fallback') {
    return fallbackForCategory(categoryKey);
  }

  const callOnce = async (extraSystem?: string): Promise<string> => {
    const fullSystem = extraSystem ? `${systemPrompt}\n\n${extraSystem}` : systemPrompt;
    if (provider === 'xai') {
      return await callXai({
        model,
        system: fullSystem,
        messages,
      });
    }
    return await callAnthropic({
      model,
      system: fullSystem,
      messages,
    });
  };

  let raw: string;
  try {
    raw = await callOnce();
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, category: categoryKey, provider },
      'Gus LLM call failed — using fallback',
    );
    return fallbackForCategory(categoryKey);
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
    return fallbackForCategory(categoryKey);
  }

  const filtered = applyPostFilter(cleanGeneratedText(raw), input.swearingCeiling);
  if (!filtered.text) return fallbackForCategory(categoryKey);
  return {
    content: filtered.text,
    modelUsed: model,
  };
}

export function resolveGusProvider(): GusProvider {
  if (env.GUS_LLM_PROVIDER) {
    if (env.GUS_LLM_PROVIDER === 'xai' && !env.XAI_API_KEY) return 'fallback';
    if (env.GUS_LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) return 'fallback';
    return env.GUS_LLM_PROVIDER;
  }
  if (env.XAI_API_KEY) return 'xai';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'fallback';
}

function xaiModelForCategory(categoryKey: NonNullable<GenerateInput['categoryKey']>): string {
  return categoryKey === 'chat' ? env.GUS_XAI_CHAT_MODEL : env.GUS_XAI_NOTIFICATION_MODEL;
}

export function configuredModelForCategory(
  categoryKey: NonNullable<GenerateInput['categoryKey']>,
): string {
  const cfg = getCategoryConfig(categoryKey);
  return resolveGusProvider() === 'xai' ? xaiModelForCategory(categoryKey) : cfg.model;
}

function fallbackForCategory(categoryKey: NonNullable<GenerateInput['categoryKey']>): GenerateOutput {
  return {
    content:
      categoryKey in FALLBACK_REPLIES
        ? FALLBACK_REPLIES[categoryKey as keyof typeof FALLBACK_REPLIES]
        : FALLBACK_REPLIES.generic,
    modelUsed: 'fallback',
  };
}

async function callAnthropic(input: {
  model: GusModel;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const anthropic = (await loadAnthropic()) as null | {
    messages: {
      create: (args: unknown) => Promise<{
        content: Array<{ type: string; text?: string }>;
      }>;
    };
  };
  if (!anthropic) throw new Error('Anthropic SDK not loadable');

  const response = await anthropic.messages.create({
    model: input.model,
    max_tokens: 320,
    system: input.system,
    messages: input.messages,
  });
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
}

async function callXai(input: {
  model: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.GUS_LLM_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.XAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.XAI_API_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        max_tokens: 320,
        messages: [
          { role: 'system', content: input.system },
          ...input.messages,
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`xAI ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          typeof part === 'object' && part !== null && 'text' in part
            ? String((part as { text?: unknown }).text ?? '')
            : '',
        )
        .join('\n')
        .trim();
    }
    throw new Error('xAI response did not include message content');
  } finally {
    clearTimeout(timeout);
  }
}

function cleanGeneratedText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*(?:\*\*)?(?:gus|human|assistant|user|dog)(?:\*\*)?\s*:\s*/i, '')
    .trim();
}
