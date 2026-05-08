import type {
  ChatMessage as SharedChatMessage,
  DogProfile,
  GusPrefs,
  SwearingCeiling,
  UpsertDogProfileRequest,
  UpsertGusPrefsRequest,
} from '@parkwalk/shared';

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
