import type { ChatMessage } from '@parkwalk/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useChatStore } from '@/stores/chatStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export function ChatScreen(_props: Props): JSX.Element {
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const loaded = useChatStore((s) => s.loaded);
  const sending = useChatStore((s) => s.sending);
  const error = useChatStore((s) => s.error);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (messages.length > 0 || sending) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length, sending]);

  const canSend = draft.trim().length > 0 && !sending;

  const data = useMemo(() => messages, [messages]);

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft('');
    await sendMessage(content);
  }

  if (loading && !loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={styles.retryButton}
            onPress={() => void loadMessages()}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={[
          styles.messageList,
          data.length === 0 ? styles.emptyMessageList : null,
        ]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>Say something to Gus.</Text>
          </View>
        }
        ListFooterComponent={sending ? <ThinkingBubble /> : null}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message Gus"
          multiline
          maxLength={2000}
          editable={!sending}
          returnKeyType="send"
          onSubmitEditing={() => {
            if (!draft.includes('\n')) void submit();
          }}
        />
        <Pressable
          accessibilityRole="button"
          style={[styles.sendButton, !canSend ? styles.sendButtonDisabled : null]}
          disabled={!canSend}
          onPress={() => void submit()}
        >
          <Text style={styles.sendButtonText}>{sending ? '...' : 'Send'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.gusRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.gusBubble]}>
        {message.category ? <Text style={styles.category}>{formatCategory(message.category)}</Text> : null}
        <Text style={[styles.messageText, isUser ? styles.userText : styles.gusText]}>
          {message.content}
        </Text>
        <Text style={[styles.timestamp, isUser ? styles.userTimestamp : styles.gusTimestamp]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

function ThinkingBubble(): JSX.Element {
  return (
    <View style={[styles.messageRow, styles.gusRow]}>
      <View style={[styles.bubble, styles.gusBubble, styles.thinkingBubble]}>
        <ActivityIndicator size="small" />
        <Text style={styles.thinkingText}>Gus is thinking...</Text>
      </View>
    </View>
  );
}

function formatCategory(category: ChatMessage['category']): string {
  if (!category) return '';
  return category.replace(/_/g, ' ');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBanner: {
    margin: 12,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  errorText: { flex: 1, color: '#991B1B', fontSize: 13 },
  retryButton: { paddingHorizontal: 8, paddingVertical: 6 },
  retryText: { color: '#991B1B', fontWeight: '700' },
  messageList: { padding: 14, gap: 10 },
  emptyMessageList: { flexGrow: 1, justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  emptyText: { color: '#6B7280', fontSize: 14 },
  messageRow: { flexDirection: 'row' },
  userRow: { justifyContent: 'flex-end' },
  gusRow: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  userBubble: { backgroundColor: '#111827' },
  gusBubble: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  messageText: { fontSize: 16, lineHeight: 21 },
  userText: { color: 'white' },
  gusText: { color: '#111827' },
  category: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  timestamp: { marginTop: 5, fontSize: 11, alignSelf: 'flex-end' },
  userTimestamp: { color: '#D1D5DB' },
  gusTimestamp: { color: '#9CA3AF' },
  thinkingBubble: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { color: '#4B5563', fontSize: 14 },
  composer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: 'white',
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  sendButton: {
    minHeight: 42,
    minWidth: 68,
    borderRadius: 8,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sendButtonDisabled: { opacity: 0.45 },
  sendButtonText: { color: 'white', fontWeight: '700', fontSize: 15 },
});
