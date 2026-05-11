import { z } from 'zod';

import { timestampSchema, uuidSchema } from './primitives.js';

export const gusMessageRoleSchema = z.enum(['user', 'gus']);
export type GusMessageRole = z.infer<typeof gusMessageRoleSchema>;

export const gusMessageKindSchema = z.enum([
  'user_message',
  'gus_reply',
  'gus_intro',
  'gus_notification',
  'user_quick_reply',
  'gus_quick_reply_followup',
]);
export type GusMessageKind = z.infer<typeof gusMessageKindSchema>;

export const gusNotificationCategorySchema = z.enum([
  'morning_check_in',
  'walk_reminder',
  'post_walk_debrief',
]);
export type GusNotificationCategory = z.infer<typeof gusNotificationCategorySchema>;

export const gusQuickReplyDataFieldSchema = z.enum([
  'mood',
  'motor_state',
  'tremor',
  'energy',
  'meds',
  'free_note',
]);
export type GusQuickReplyDataField = z.infer<typeof gusQuickReplyDataFieldSchema>;

export const gusQuickReplySchema = z.object({
  value: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  dataField: gusQuickReplyDataFieldSchema,
});
export type GusQuickReply = z.infer<typeof gusQuickReplySchema>;

export const chatMessageSchema = z.object({
  id: uuidSchema,
  role: gusMessageRoleSchema,
  kind: gusMessageKindSchema,
  category: gusNotificationCategorySchema.nullable(),
  content: z.string(),
  quickReplies: z.array(gusQuickReplySchema).nullable(),
  selectedReply: z.string().nullable(),
  modelUsed: z.string().nullable(),
  createdAt: timestampSchema,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const swearingCeilingSchema = z.enum(['off', 'mild', 'full']);
export type SwearingCeiling = z.infer<typeof swearingCeilingSchema>;

const timeOfDayString = z
  .string()
  .regex(/^[0-2]\d:[0-5]\d$/, 'Expected HH:MM');

export const dogPersonalityFloatsSchema = z.object({
  warmth: z.number().min(0).max(1),
  verbosity: z.number().min(0).max(1),
  political: z.number().min(0).max(1),
  competitiveness: z.number().min(0).max(1),
});
export type DogPersonalityFloats = z.infer<typeof dogPersonalityFloatsSchema>;

export const dogProfileSchema = z.object({
  dogName: z.string().min(1).max(60),
  breedCosmetic: z.string().max(60).nullable(),
  warmth: z.number().min(0).max(1),
  verbosity: z.number().min(0).max(1),
  political: z.number().min(0).max(1),
  competitiveness: z.number().min(0).max(1),
});
export type DogProfile = z.infer<typeof dogProfileSchema>;

export const upsertDogProfileRequestSchema = dogProfileSchema.partial().strict();
export type UpsertDogProfileRequest = z.infer<typeof upsertDogProfileRequestSchema>;

export const dogProfileResponseSchema = z.object({ profile: dogProfileSchema });
export type DogProfileResponse = z.infer<typeof dogProfileResponseSchema>;

export const gusPrefsSchema = z.object({
  morningCheckInTime: timeOfDayString,
  walkReminderTime: timeOfDayString,
  morningEnabled: z.boolean(),
  walkEnabled: z.boolean(),
  postWalkEnabled: z.boolean(),
  quietHoursStart: timeOfDayString,
  quietHoursEnd: timeOfDayString,
  timezone: z.string().min(1).max(60),
  swearingCeiling: swearingCeilingSchema,
  chatModel: z.string().min(1).max(120).nullable(),
  notificationModel: z.string().min(1).max(120).nullable(),
});
export type GusPrefs = z.infer<typeof gusPrefsSchema>;

export const upsertGusPrefsRequestSchema = gusPrefsSchema.partial().strict();
export type UpsertGusPrefsRequest = z.infer<typeof upsertGusPrefsRequestSchema>;

export const gusPrefsResponseSchema = z.object({ prefs: gusPrefsSchema });
export type GusPrefsResponse = z.infer<typeof gusPrefsResponseSchema>;

export const gusModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type GusModelOption = z.infer<typeof gusModelOptionSchema>;

export const gusModelsResponseSchema = z.object({
  provider: z.enum(['xai', 'anthropic', 'fallback']),
  chatModel: z.string(),
  notificationModel: z.string(),
  items: z.array(gusModelOptionSchema),
});
export type GusModelsResponse = z.infer<typeof gusModelsResponseSchema>;

export const sendChatRequestSchema = z
  .object({
    content: z.string().min(1).max(2000),
  })
  .strict();
export type SendChatRequest = z.infer<typeof sendChatRequestSchema>;

export const sendChatResponseSchema = z.object({
  userMessage: chatMessageSchema,
  gusReply: chatMessageSchema,
});
export type SendChatResponse = z.infer<typeof sendChatResponseSchema>;

export const chatMessagesResponseSchema = z.object({
  items: z.array(chatMessageSchema),
});
export type ChatMessagesResponse = z.infer<typeof chatMessagesResponseSchema>;

export const submitQuickReplyRequestSchema = z
  .object({
    messageId: uuidSchema,
    value: z.string().min(1).max(80),
  })
  .strict();
export type SubmitQuickReplyRequest = z.infer<typeof submitQuickReplyRequestSchema>;

export const submitQuickReplyResponseSchema = z.object({
  userMessage: chatMessageSchema,
  gusReply: chatMessageSchema,
  sourceMessage: chatMessageSchema,
});
export type SubmitQuickReplyResponse = z.infer<typeof submitQuickReplyResponseSchema>;

export const fireNotificationRequestSchema = z
  .object({
    category: gusNotificationCategorySchema,
  })
  .strict();
export type FireNotificationRequest = z.infer<typeof fireNotificationRequestSchema>;

export const fireNotificationResponseSchema = z.object({
  message: chatMessageSchema,
});
export type FireNotificationResponse = z.infer<typeof fireNotificationResponseSchema>;

export const gusIntroResponseSchema = z.object({
  message: chatMessageSchema.nullable(),
});
export type GusIntroResponse = z.infer<typeof gusIntroResponseSchema>;
