import type { ChatMessage } from '@parkwalk/shared';
import { create } from 'zustand';

import { fetchChatMessages, sendChat } from '@/services/gusApi';
import { describeApiError } from '@/util/describeApiError';

interface ChatStoreState {
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  loaded: boolean;
  error: string | null;
  loadMessages: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  reset: () => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [],
  loading: false,
  sending: false,
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

  reset: () => set({ messages: [], loading: false, sending: false, loaded: false, error: null }),
}));
