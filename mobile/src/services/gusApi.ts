import type {
  ChatMessage,
  ChatMessagesResponse,
  DogProfile,
  DogProfileResponse,
  GusModelsResponse,
  GusPrefs,
  GusPrefsResponse,
  SendChatRequest,
  SendChatResponse,
  SubmitQuickReplyRequest,
  SubmitQuickReplyResponse,
  UpsertDogProfileRequest,
  UpsertGusPrefsRequest,
} from '@parkwalk/shared';

import { api } from './apiClient';

const CHAT_TIMEOUT_MS = 30_000;

export async function fetchDogProfile(): Promise<DogProfile> {
  const { data } = await api.get<DogProfileResponse>('/api/v1/gus/profile');
  return data.profile;
}

export async function upsertDogProfile(patch: UpsertDogProfileRequest): Promise<DogProfile> {
  const { data } = await api.post<DogProfileResponse>('/api/v1/gus/profile', patch);
  return data.profile;
}

export async function fetchGusPrefs(): Promise<GusPrefs> {
  const { data } = await api.get<GusPrefsResponse>('/api/v1/gus/prefs');
  return data.prefs;
}

export async function fetchGusModels(): Promise<GusModelsResponse> {
  const { data } = await api.get<GusModelsResponse>('/api/v1/gus/models');
  return data;
}

export async function upsertGusPrefs(patch: UpsertGusPrefsRequest): Promise<GusPrefs> {
  const { data } = await api.post<GusPrefsResponse>('/api/v1/gus/prefs', patch);
  return data.prefs;
}

export async function fetchChatMessages(): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessagesResponse>('/api/v1/gus/messages');
  return data.items;
}

export async function sendChat(request: SendChatRequest): Promise<SendChatResponse> {
  const { data } = await api.post<SendChatResponse>('/api/v1/gus/chat', request, {
    timeout: CHAT_TIMEOUT_MS,
  });
  return data;
}

export async function submitQuickReply(
  request: SubmitQuickReplyRequest,
): Promise<SubmitQuickReplyResponse> {
  const { data } = await api.post<SubmitQuickReplyResponse>('/api/v1/gus/quickReply', request, {
    timeout: CHAT_TIMEOUT_MS,
  });
  return data;
}
