import type { ChatMessage, GusNotificationCategory } from '@parkwalk/shared';
import { create } from 'zustand';

import {
  fetchChatMessages,
  fireGusNotification,
  sendChat,
  submitQuickReply,
} from '@/services/gusApi';
import { describeApiError } from '@/util/describeApiError';

function clientUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export type FiringCategory = GusNotificationCategory | 'gus_intro' | null;

interface ChatStoreState {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  replyingToMessageId: string | null;
  firingCategory: FiringCategory;
  loaded: boolean;
  error: string | null;
  loadMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  submitQuickReply: (messageId: string, value: string) => Promise<void>;
  fireNotification: (category: GusNotificationCategory) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
  replyingToMessageId: null,
  firingCategory: null,
  loaded: false,
  error: null,

  loadMessages: async () => {
    set({ loading: true, loaded: false, error: null, messages: [] });
    try {
      const messages = await fetchChatMessages();
      set({ messages, loading: false, loaded: true });
    } catch (err) {
      set({ loading: false, loaded: true, error: describeApiError(err) });
    }
  },

  sendMessage: async (content) => {
    const trimmed = content.trim();
    if (!trimmed || get().sending) return;

    // Optimistic insertion: the user's message lands in the list immediately
    // and the thinking bubble appears below it; on response we swap the
    // optimistic id for the server's authoritative record and append Gus.
    // On failure we roll the optimistic message back out.
    const localId = clientUuid();
    const optimisticMessage: ChatMessage = {
      id: localId,
      role: 'user',
      kind: 'user_message',
      category: null,
      content: trimmed,
      quickReplies: null,
      selectedReply: null,
      modelUsed: null,
      createdAt: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, optimisticMessage],
      sending: true,
      error: null,
    }));

    try {
      const result = await sendChat({ content: trimmed });
      set((state) => ({
        messages: [
          ...state.messages.map((m) => (m.id === localId ? result.userMessage : m)),
          result.gusReply,
        ],
        sending: false,
        loaded: true,
      }));
    } catch (err) {
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== localId),
        sending: false,
        error: describeApiError(err),
      }));
    }
  },

  submitQuickReply: async (messageId, value) => {
    if (get().replyingToMessageId) return;

    set({ replyingToMessageId: messageId, error: null });
    try {
      const result = await submitQuickReply({ messageId, value });
      set((state) => ({
        messages: [
          ...state.messages.map((m) => (m.id === messageId ? result.sourceMessage : m)),
          result.userMessage,
          result.gusReply,
        ],
        replyingToMessageId: null,
        loaded: true,
      }));
    } catch (err) {
      set({ replyingToMessageId: null, error: describeApiError(err) });
    }
  },

  fireNotification: async (category) => {
    if (get().firingCategory) return;

    set({ firingCategory: category, error: null });
    try {
      const result = await fireGusNotification({ category });
      set((state) => ({
        messages: [...state.messages, result.message],
        firingCategory: null,
        loaded: true,
      }));
    } catch (err) {
      set({ firingCategory: null, error: describeApiError(err) });
    }
  },

  reset: () =>
    set({
      messages: [],
      loading: false,
      sending: false,
      replyingToMessageId: null,
      firingCategory: null,
      loaded: false,
      error: null,
    }),
}));
