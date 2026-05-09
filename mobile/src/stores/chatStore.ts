import type { ChatMessage, GusNotificationCategory } from '@parkwalk/shared';
import { create } from 'zustand';

import {
  fetchChatMessages,
  fireGusNotification,
  sendChat,
  submitQuickReply,
} from '@/services/gusApi';
import { describeApiError } from '@/util/describeApiError';

interface ChatStoreState {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  replyingToMessageId: string | null;
  firingCategory: GusNotificationCategory | null;
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

    set({ sending: true, error: null });
    try {
      const result = await sendChat({ content: trimmed });
      set((state) => ({
        messages: [...state.messages, result.userMessage, result.gusReply],
        sending: false,
        loaded: true,
      }));
    } catch (err) {
      set({ sending: false, error: describeApiError(err) });
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
