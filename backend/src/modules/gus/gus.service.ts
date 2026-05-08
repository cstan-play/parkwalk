import type {
  ChatMessage as SharedChatMessage,
  DogProfile,
  GusQuickReply,
  GusPrefs,
  SwearingCeiling,
  UpsertDogProfileRequest,
  UpsertGusPrefsRequest,
} from '@parkwalk/shared';
import { gusQuickReplySchema } from '@parkwalk/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound, validationError } from '../../errors.js';
import { prisma } from '../../prisma.js';

import { assembleContextForPrompt } from './context.service.js';
import { generate, type VoiceConversationTurn } from './voice.service.js';

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

export async function sendUserMessage(
  userId: string,
  ownerName: string,
  content: string,
): Promise<SendChatResult> {
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
      if (reply.value === 'barely') return "Noted. We're keeping the bar on the floor today.";
      return 'Noted. I will be normal about this for almost ten seconds.';
    case 'motor_state':
      if (reply.value === 'off') return "Got it. Short leash today, metaphorically. I hate metaphors.";
      if (reply.value === 'bit_off') return 'Logged. I will pretend not to hover.';
      return 'Good. I noticed. Briefly mature of me.';
    default:
      return 'Noted. Filed under things I pretend not to care about.';
  }
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
