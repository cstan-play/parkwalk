import type {
  ChatMessage as SharedChatMessage,
  DogProfile,
  GusNotificationCategory,
  GusModelOption,
  GusModelsResponse,
  GusQuickReply,
  GusPrefs,
  SwearingCeiling,
  UpsertDogProfileRequest,
  UpsertGusPrefsRequest,
} from '@parkwalk/shared';
import { getCategoryConfig, gusQuickReplySchema } from '@parkwalk/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { env } from '../../env.js';
import { conflict, notFound, validationError } from '../../errors.js';
import { prisma } from '../../prisma.js';

import {
  assembleContextForPrompt,
  assembleWeatherDebug,
  type WeatherDebugSnapshot,
} from './context.service.js';
import {
  configuredModelForCategory,
  generate,
  resolveGusProvider,
  type VoiceConversationTurn,
} from './voice.service.js';

const RECENT_HISTORY_LIMIT = 10;

export async function getOrCreateDogProfile(userId: string): Promise<DogProfile> {
  const row = await prisma.dogProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return rowToProfile(row);
}

export async function upsertDogProfile(
  userId: string,
  patch: UpsertDogProfileRequest,
): Promise<DogProfile> {
  const row = await prisma.dogProfile.upsert({
    where: { userId },
    create: {
      userId,
      ...patch,
      breedCosmetic: patch.breedCosmetic ?? null,
    },
    update: {
      ...patch,
      breedCosmetic: patch.breedCosmetic === undefined ? undefined : patch.breedCosmetic ?? null,
    },
  });
  return rowToProfile(row);
}

export async function getOrCreateGusPrefs(userId: string): Promise<GusPrefs> {
  const row = await prisma.gusPrefs.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return rowToPrefs(row);
}

export async function upsertGusPrefs(
  userId: string,
  patch: UpsertGusPrefsRequest,
): Promise<GusPrefs> {
  const row = await prisma.gusPrefs.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: { ...patch },
  });
  return rowToPrefs(row);
}

export async function listGusModels(): Promise<GusModelsResponse> {
  const provider = resolveGusProvider();
  const chatModel = configuredModelForCategory('chat');
  const notificationModel = configuredModelForCategory('morning_check_in');

  if (provider !== 'xai') {
    return {
      provider,
      chatModel,
      notificationModel,
      items: uniqModelOptions([chatModel, notificationModel]),
    };
  }

  const remote = await fetchXaiModelOptions();
  return {
    provider,
    chatModel,
    notificationModel,
    items: remote.length > 0 ? remote : uniqModelOptions([chatModel, notificationModel]),
  };
}

export async function listMessages(userId: string): Promise<SharedChatMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return rows.map(rowToMessage);
}

export interface SendChatResult {
  userMessage: SharedChatMessage;
  gusReply: SharedChatMessage;
}

export interface SubmitQuickReplyResult {
  userMessage: SharedChatMessage;
  gusReply: SharedChatMessage;
  sourceMessage: SharedChatMessage;
}

export interface FireNotificationResult {
  message: SharedChatMessage;
}

export interface EnsureIntroResult {
  message: SharedChatMessage | null;
}

export async function sendUserMessage(
  userId: string,
  ownerName: string,
  content: string,
): Promise<SendChatResult> {
  if (isOpenMeteoDebugCommand(content)) {
    return handleOpenMeteoDebug(userId, content);
  }

  const profile = await getOrCreateDogProfile(userId);
  const prefs = await getOrCreateGusPrefs(userId);
  const context = await assembleContextForPrompt({ userId, ownerName });

  const recentRows = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_HISTORY_LIMIT,
  });
  const history: VoiceConversationTurn[] = recentRows
    .reverse()
    .map((row) => ({
      role: row.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: row.content,
    }));

  const generated = await generate({
    dogProfile: profile,
    context,
    history,
    categoryKey: 'chat',
    userMessage: content,
    swearingCeiling: prefs.swearingCeiling as SwearingCeiling,
    modelOverride: prefs.chatModel,
  });

  const result = await prisma.$transaction(async (tx) => {
    const userRow = await tx.chatMessage.create({
      data: {
        userId,
        role: 'user',
        kind: 'user_message',
        content,
      },
    });
    const gusRow = await tx.chatMessage.create({
      data: {
        userId,
        role: 'gus',
        kind: 'gus_reply',
        content: generated.content,
        modelUsed: generated.modelUsed,
      },
    });
    return { userMessage: rowToMessage(userRow), gusReply: rowToMessage(gusRow) };
  });

  return result;
}

export async function ensureIntroMessage(
  userId: string,
  ownerName: string,
): Promise<EnsureIntroResult> {
  const existing = await prisma.chatMessage.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { message: null };

  const profile = await getOrCreateDogProfile(userId);
  const prefs = await getOrCreateGusPrefs(userId);
  const context = await assembleContextForPrompt({ userId, ownerName });

  const generated = await generate({
    dogProfile: profile,
    context,
    history: [],
    categoryKey: 'gus_intro',
    userMessage: introPrompt(),
    swearingCeiling: prefs.swearingCeiling as SwearingCeiling,
    modelOverride: prefs.chatModel,
  });

  const row = await prisma.$transaction(async (tx) => {
    const raced = await tx.chatMessage.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    if (raced) return null;

    return await tx.chatMessage.create({
      data: {
        userId,
        role: 'gus',
        kind: 'gus_intro',
        category: null,
        content: generated.content,
        modelUsed: generated.modelUsed,
      },
    });
  });

  return { message: row ? rowToMessage(row) : null };
}

/**
 * Operator escape hatch. When the user types exactly "OpenMeteo" (case
 * insensitive) we bypass the LLM and reply with the raw upstream weather
 * snapshot so you can see what data Gus is actually being told about the
 * world — useful for sanity-checking the bake before trusting Gus's tone.
 */
function isOpenMeteoDebugCommand(content: string): boolean {
  return content.trim().toLowerCase() === 'openmeteo';
}

async function handleOpenMeteoDebug(userId: string, content: string): Promise<SendChatResult> {
  const snapshot = await assembleWeatherDebug({ userId });
  const replyText = formatOpenMeteoDebugReply(snapshot);
  return prisma.$transaction(async (tx) => {
    const userRow = await tx.chatMessage.create({
      data: { userId, role: 'user', kind: 'user_message', content },
    });
    const gusRow = await tx.chatMessage.create({
      data: {
        userId,
        role: 'gus',
        kind: 'gus_reply',
        content: replyText,
        modelUsed: 'debug:openmeteo',
      },
    });
    return { userMessage: rowToMessage(userRow), gusReply: rowToMessage(gusRow) };
  });
}

function formatOpenMeteoDebugReply(snapshot: WeatherDebugSnapshot): string {
  const lines: string[] = ['OpenMeteo debug'];
  if (!snapshot.coords) {
    lines.push(
      '',
      'No coordinates resolved — you have no completed walks yet, so',
      'weather stays null and the "Weather:" line is omitted from the',
      'system prompt entirely.',
    );
    return lines.join('\n');
  }
  const sourceLabel = snapshot.coords.source === 'input' ? 'request input' : 'last completed walk';
  lines.push(
    '',
    `Coords: ${snapshot.coords.lat.toFixed(4)}, ${snapshot.coords.lng.toFixed(4)} (${sourceLabel})`,
  );
  if (!snapshot.weather.raw) {
    lines.push('', 'Upstream call failed or returned no current data.');
    return lines.join('\n');
  }
  const r = snapshot.weather.raw;
  lines.push(
    '',
    'Raw upstream (uncached):',
    `- weather_code: ${r.weather_code ?? '—'}`,
    `- temperature_2m: ${r.temperature_2m ?? '—'} °C`,
    `- precipitation: ${r.precipitation ?? '—'} mm`,
    `- wind_speed_10m: ${r.wind_speed_10m ?? '—'} m/s`,
    '',
    `Baked into system prompt: ${
      snapshot.weather.description ? `"${snapshot.weather.description}"` : 'null (Weather line omitted)'
    }`,
  );
  return lines.join('\n');
}

export async function submitQuickReply(
  userId: string,
  ownerName: string,
  messageId: string,
  value: string,
): Promise<SubmitQuickReplyResult> {
  const source = await prisma.chatMessage.findFirst({
    where: { id: messageId, userId, role: 'gus' },
  });
  if (!source) throw notFound('Gus message not found');
  if (source.selectedReply) throw conflict('Quick reply already selected');

  const quickReplies = parseQuickReplies(source.quickReplies);
  const selected = quickReplies.find((reply) => reply.value === value);
  if (!selected) throw validationError('Quick reply is not available for this message');

  const profile = await getOrCreateDogProfile(userId);
  const prefs = await getOrCreateGusPrefs(userId);
  const context = await assembleContextForPrompt({ userId, ownerName });
  const history = await buildRecentHistory(userId);

  const generated = await generate({
    dogProfile: profile,
    context,
    history,
    categoryKey: 'chat',
    userMessage: `The user tapped this quick reply: "${selected.label}". It records ${selected.dataField}=${selected.value}. Reply once, in one short line. Acknowledge it without therapy-speak.`,
    swearingCeiling: prefs.swearingCeiling as SwearingCeiling,
    modelOverride: prefs.chatModel,
  });
  const fallback = quickReplyFallback(selected);
  const followupContent = generated.modelUsed === 'fallback' ? fallback : generated.content;

  return await prisma.$transaction(async (tx) => {
    await upsertDailyStateFromQuickReply(tx, userId, selected);

    const sourceRow = await tx.chatMessage.update({
      where: { id: source.id },
      data: { selectedReply: selected.value },
    });
    const userRow = await tx.chatMessage.create({
      data: {
        userId,
        role: 'user',
        kind: 'user_quick_reply',
        category: source.category,
        content: selected.label,
        selectedReply: selected.value,
      },
    });
    const gusRow = await tx.chatMessage.create({
      data: {
        userId,
        role: 'gus',
        kind: 'gus_quick_reply_followup',
        category: source.category,
        content: followupContent,
        modelUsed: generated.modelUsed,
      },
    });

    return {
      sourceMessage: rowToMessage(sourceRow),
      userMessage: rowToMessage(userRow),
      gusReply: rowToMessage(gusRow),
    };
  });
}

export async function fireNotificationMessage(
  userId: string,
  ownerName: string,
  category: GusNotificationCategory,
): Promise<FireNotificationResult> {
  const profile = await getOrCreateDogProfile(userId);
  const prefs = await getOrCreateGusPrefs(userId);
  const context = await assembleContextForPrompt({ userId, ownerName });
  const cfg = getCategoryConfig(category);

  const generated = await generate({
    dogProfile: profile,
    context,
    history: [],
    categoryKey: category,
    userMessage: notificationPrompt(category),
    swearingCeiling: prefs.swearingCeiling as SwearingCeiling,
    modelOverride: prefs.notificationModel,
  });

  const row = await prisma.chatMessage.create({
    data: {
      userId,
      role: 'gus',
      kind: 'gus_notification',
      category,
      content: generated.content,
      quickReplies: cfg.quickReplies.length > 0 ? cfg.quickReplies : undefined,
      modelUsed: generated.modelUsed,
    },
  });

  return { message: rowToMessage(row) };
}

async function buildRecentHistory(userId: string): Promise<VoiceConversationTurn[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: RECENT_HISTORY_LIMIT,
  });
  return rows.reverse().map((row) => ({
    role: row.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: row.content,
  }));
}

function parseQuickReplies(raw: unknown): GusQuickReply[] {
  const parsed = z.array(gusQuickReplySchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

async function upsertDailyStateFromQuickReply(
  tx: Prisma.TransactionClient,
  userId: string,
  reply: GusQuickReply,
): Promise<void> {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);

  switch (reply.dataField) {
    case 'mood':
      await tx.userDailyState.upsert({
        where: { unique_user_daily_state: { userId, date } },
        update: { mood: reply.value },
        create: { userId, date, mood: reply.value },
      });
      return;
    case 'motor_state':
      await tx.userDailyState.upsert({
        where: { unique_user_daily_state: { userId, date } },
        update: { motorState: reply.value },
        create: { userId, date, motorState: reply.value },
      });
      return;
    case 'tremor':
      await tx.userDailyState.upsert({
        where: { unique_user_daily_state: { userId, date } },
        update: { tremor: reply.value },
        create: { userId, date, tremor: reply.value },
      });
      return;
    case 'energy':
      await tx.userDailyState.upsert({
        where: { unique_user_daily_state: { userId, date } },
        update: { energy: reply.value },
        create: { userId, date, energy: reply.value },
      });
      return;
    case 'meds':
      await tx.userDailyState.upsert({
        where: { unique_user_daily_state: { userId, date } },
        update: { medsTaken: [isAffirmative(reply.value)] },
        create: { userId, date, medsTaken: [isAffirmative(reply.value)] },
      });
      return;
    case 'free_note':
      await tx.userDailyState.upsert({
        where: { unique_user_daily_state: { userId, date } },
        update: { freeNote: reply.value },
        create: { userId, date, freeNote: reply.value },
      });
      return;
  }
}

function isAffirmative(value: string): boolean {
  return ['yes', 'true', 'taken', 'done', '1'].includes(value.toLowerCase());
}

function quickReplyFallback(reply: GusQuickReply): string {
  switch (reply.dataField) {
    case 'mood':
      if (reply.value === 'no') return "Okay. I'm here. No speech.";
      if (reply.value === 'barely') return "Logged. Low bar day. I can work with low bars.";
      return 'Noted. I will be normal about this for almost ten seconds.';
    case 'motor_state':
      if (reply.value === 'off') return "Got it. Gentle settings today.";
      if (reply.value === 'bit_off') return 'Logged. I will pretend not to hover.';
      return 'Good. I noticed. Briefly mature of me.';
    default:
      return 'Noted. Filed under things I pretend not to care about.';
  }
}

function notificationPrompt(category: GusNotificationCategory): string {
  switch (category) {
    case 'morning_check_in':
      return [
        'Write the morning check-in message now.',
        'End by asking one plain question about how today feels; the attached buttons answer it.',
        'Do not continue or quote prior chat messages.',
        'Do not print quick-reply labels, button values, markdown, or code fences.',
        'One short Gus message only.',
      ].join(' ');
    case 'walk_reminder':
      return [
        'Write the walk reminder message now.',
        'Do not continue or quote prior chat messages.',
        'Do not print quick-reply labels, markdown, or code fences.',
        'One short Gus message only.',
      ].join(' ');
    case 'post_walk_debrief':
      return [
        'Write the post-walk debrief message now.',
        'A walk just ended recently; this is not a morning check-in.',
        'End by asking one plain question about how their body or motor state feels after the walk; the attached buttons answer it.',
        'Do not call it an evening check-in, morning check-in, status check, or check-in.',
        'Do not continue or quote prior chat messages.',
        'Do not print quick-reply labels, button values, markdown, or code fences.',
        'One short Gus message only.',
      ].join(' ');
  }
}

function introPrompt(): string {
  return [
    'Write Gus\'s first chat introduction now.',
    'This is the first message the user sees in chat.',
    'One warm, witty Gus message only.',
    'Do not print labels, markdown, bullet points, or code fences.',
  ].join(' ');
}

async function fetchXaiModelOptions(): Promise<GusModelOption[]> {
  const baseUrl = env.XAI_BASE_URL.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${env.XAI_API_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };

  for (const path of ['/language-models', '/models']) {
    try {
      const res = await fetch(`${baseUrl}${path}`, { headers });
      if (!res.ok) continue;
      const data = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown }> };
      const ids = (data.data ?? [])
        .map((m) => (typeof m.id === 'string' ? m.id : typeof m.name === 'string' ? m.name : null))
        .filter((id): id is string => !!id);
      if (ids.length > 0) return uniqModelOptions(ids);
    } catch {
      // Fall through to the next endpoint/fallback defaults.
    }
  }

  return [];
}

function uniqModelOptions(ids: string[]): GusModelOption[] {
  return Array.from(new Set(ids.filter(Boolean))).map((id) => ({ id, label: id }));
}

type ProfileRow = {
  dogName: string;
  breedCosmetic: string | null;
  warmth: number;
  verbosity: number;
  political: number;
  competitiveness: number;
};

function rowToProfile(row: ProfileRow): DogProfile {
  return {
    dogName: row.dogName,
    breedCosmetic: row.breedCosmetic,
    warmth: row.warmth,
    verbosity: row.verbosity,
    political: row.political,
    competitiveness: row.competitiveness,
  };
}

type PrefsRow = {
  morningCheckInTime: string;
  walkReminderTime: string;
  morningEnabled: boolean;
  walkEnabled: boolean;
  postWalkEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  swearingCeiling: string;
  chatModel: string | null;
  notificationModel: string | null;
};

function rowToPrefs(row: PrefsRow): GusPrefs {
  return {
    morningCheckInTime: row.morningCheckInTime,
    walkReminderTime: row.walkReminderTime,
    morningEnabled: row.morningEnabled,
    walkEnabled: row.walkEnabled,
    postWalkEnabled: row.postWalkEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    timezone: row.timezone,
    swearingCeiling: row.swearingCeiling as SwearingCeiling,
    chatModel: row.chatModel,
    notificationModel: row.notificationModel,
  };
}

type MessageRow = {
  id: string;
  role: string;
  kind: string;
  category: string | null;
  content: string;
  quickReplies: unknown;
  selectedReply: string | null;
  modelUsed: string | null;
  createdAt: Date;
};

function rowToMessage(row: MessageRow): SharedChatMessage {
  return {
    id: row.id,
    role: row.role as SharedChatMessage['role'],
    kind: row.kind as SharedChatMessage['kind'],
    category: (row.category as SharedChatMessage['category']) ?? null,
    content: row.content,
    quickReplies: Array.isArray(row.quickReplies)
      ? (row.quickReplies as SharedChatMessage['quickReplies'])
      : null,
    selectedReply: row.selectedReply,
    modelUsed: row.modelUsed,
    createdAt: row.createdAt.toISOString(),
  };
}
