import type { ChatMessage, GusQuickReply } from '@parkwalk/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useChatStore, type FiringCategory } from '@/stores/chatStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export function ChatScreen(_props: Props): JSX.Element {
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const loaded = useChatStore((s) => s.loaded);
  const sending = useChatStore((s) => s.sending);
  const replyingToMessageId = useChatStore((s) => s.replyingToMessageId);
  const firingCategory = useChatStore((s) => s.firingCategory);
  const error = useChatStore((s) => s.error);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const submitQuickReply = useChatStore((s) => s.submitQuickReply);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]!.id : null;

  // FlatList virtualization on iOS measures lazily — a single scrollToEnd
  // can fire before the latest item is measured, landing on the previous
  // bottom. We schedule three attempts (immediate / 60ms / 240ms) so by the
  // last one all layout work has settled. All animated:false to avoid
  // racing animations.
  const scrollToBottom = useCallback(() => {
    const doScroll = () => listRef.current?.scrollToEnd({ animated: false });
    requestAnimationFrame(doScroll);
    const t1 = setTimeout(doScroll, 60);
    const t2 = setTimeout(doScroll, 240);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (messages.length > 0 || sending || firingCategory) {
      return scrollToBottom();
    }
    return undefined;
  }, [messages.length, sending, firingCategory, replyingToMessageId, lastMessageId, scrollToBottom]);

  const canSend = draft.trim().length > 0 && !sending;

  const data = useMemo(() => messages, [messages]);

  async function submit(): Promise<void> {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft('');
    await sendMessage(content);
  }

  // Suppress the centered loading spinner if a notification fire is in
  // flight — otherwise the spinner masks the FlatList and the user never
  // sees the thinking bubble that's supposed to appear immediately on
  // notification tap.
  if (loading && !loaded && !firingCategory) {
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
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            replying={replyingToMessageId === item.id}
            onQuickReply={(value) => void submitQuickReply(item.id, value)}
          />
        )}
        contentContainerStyle={[
          styles.messageList,
          data.length === 0 ? styles.emptyMessageList : null,
        ]}
        ListEmptyComponent={
          firingCategory || loading ? null : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyText}>Say something to Gus.</Text>
            </View>
          )
        }
        ListFooterComponent={
          sending || firingCategory ? <ThinkingBubble category={firingCategory} /> : null
        }
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToBottom}
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

function MessageBubble({
  message,
  replying,
  onQuickReply,
}: {
  message: ChatMessage;
  replying: boolean;
  onQuickReply: (value: string) => void;
}): JSX.Element {
  const isUser = message.role === 'user';
  const replies = message.role === 'gus' ? message.quickReplies ?? [] : [];
  const hasReplies = replies.length > 0;
  const selectedReply = replies.find((reply) => reply.value === message.selectedReply) ?? null;
  const repliesDisabled = replying || !!message.selectedReply;
  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.gusRow]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.gusBubble]}>
        <CategoryChip message={message} />
        <Text style={[styles.messageHeader, isUser ? styles.userHeader : styles.gusHeader]}>
          {isUser ? 'You' : 'Gus'}
        </Text>
        <Text style={[styles.messageText, isUser ? styles.userText : styles.gusText]}>
          {message.content}
        </Text>
        {hasReplies ? (
          <QuickReplies
            replies={replies}
            selectedReply={selectedReply}
            disabled={repliesDisabled}
            onPress={onQuickReply}
          />
        ) : null}
        <Text style={[styles.timestamp, isUser ? styles.userTimestamp : styles.gusTimestamp]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}

function QuickReplies({
  replies,
  selectedReply,
  disabled,
  onPress,
}: {
  replies: GusQuickReply[];
  selectedReply: GusQuickReply | null;
  disabled: boolean;
  onPress: (value: string) => void;
}): JSX.Element {
  if (selectedReply) {
    return (
      <View style={styles.selectedReplyRow}>
        <Text style={styles.selectedReplyLabel}>Selected</Text>
        <View style={styles.selectedReplyPill}>
          <Text style={styles.selectedReplyText}>{selectedReply.label}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.quickReplies}>
      {replies.map((reply) => {
        return (
          <Pressable
            key={`${reply.dataField}:${reply.value}`}
            accessibilityRole="button"
            disabled={disabled}
            style={[
              styles.quickReplyButton,
              disabled ? styles.quickReplyButtonDisabled : null,
            ]}
            onPress={() => onPress(reply.value)}
          >
            <Text style={styles.quickReplyText}>{reply.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ThinkingBubble({ category }: { category: FiringCategory }): JSX.Element {
  const borderColor = categoryColor(category);
  return (
    <View style={[styles.messageRow, styles.gusRow]}>
      <View
        style={[
          styles.bubble,
          styles.gusBubble,
          styles.thinkingBubble,
          borderColor ? { borderColor, borderWidth: 1.5 } : null,
        ]}
      >
        <ActivityIndicator size="small" />
        <Text style={styles.thinkingText}>Gus is thinking...</Text>
      </View>
    </View>
  );
}

function CategoryChip({ message }: { message: ChatMessage }): JSX.Element | null {
  // The voice-prompt 'gus_intro' kind lands in Phase 8; reserved violet color
  // below is unused until then.
  if (!message.category) return null;
  const color = categoryColor(message.category);
  const label = categoryLabel(message.category);
  if (!color || !label) return null;
  return (
    <View style={[styles.categoryChip, { backgroundColor: color }]}>
      <Text style={styles.categoryChipText}>{label}</Text>
    </View>
  );
}

function categoryColor(category: FiringCategory): string | null {
  switch (category) {
    case 'morning_check_in':
      return '#F59E0B';
    case 'walk_reminder':
      return '#059669';
    case 'post_walk_debrief':
      return '#0EA5E9';
    case 'gus_intro':
      return '#7C3AED';
    default:
      return null;
  }
}

function categoryLabel(category: NonNullable<ChatMessage['category']>): string {
  switch (category) {
    case 'morning_check_in':
      return 'Morning check-in';
    case 'walk_reminder':
      return 'Walk reminder';
    case 'post_walk_debrief':
      return 'Post-walk debrief';
  }
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
  quickReplies: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickReplyButton: {
    borderWidth: 1,
    borderColor: '#059669',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#ECFDF5',
  },
  quickReplyButtonDisabled: {
    opacity: 0.45,
  },
  quickReplyText: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '700',
  },
  selectedReplyRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedReplyLabel: { color: '#6B7280', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  selectedReplyPill: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#111827',
  },
  selectedReplyText: { color: 'white', fontSize: 13, fontWeight: '700' },
  messageHeader: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  categoryChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 6,
  },
  categoryChipText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  gusHeader: { color: '#6B7280' },
  userHeader: { color: '#9CA3AF' },
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
