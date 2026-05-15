import type { ChatMessage, GusQuickReply } from '@parkwalk/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FigmaArrow } from '@/components/ui/FigmaArrow';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useChatStore, type FiringCategory } from '@/stores/chatStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export function ChatScreen({ navigation }: Props): JSX.Element {
  const insets = useSafeAreaInsets();
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
  const headerHeight = 118 + insets.top;

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
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { height: headerHeight, paddingTop: insets.top + 36 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to homescreen"
          hitSlop={8}
          style={({ pressed }) => [
            styles.backButton,
            { top: insets.top + 36 },
            pressed && styles.circleButtonPressed,
          ]}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('Map');
            }
          }}
        >
          <FigmaArrow direction="back" size={38} />
        </Pressable>
        <Text style={styles.headerTitle}>Back to homescreen</Text>
      </View>
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

      <View style={[styles.composer, { paddingBottom: insets.bottom + 20 }]}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Type your message to Gus"
          placeholderTextColor="#97948C"
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
          {sending ? <Text style={styles.sendButtonText}>...</Text> : <FigmaArrow size={38} />}
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
      {isUser ? null : <GusAvatar />}
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
      <GusAvatar />
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

function GusAvatar(): JSX.Element {
  return (
    <View style={styles.avatarRing}>
      <Image
        source={require('../assets/onboarding/gus-avatar.png')}
        style={styles.avatarImage}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

function CategoryChip({ message }: { message: ChatMessage }): JSX.Element | null {
  const chipKey = message.kind === 'gus_intro' ? 'gus_intro' : message.category;
  if (!chipKey) return null;
  const color = categoryColor(chipKey);
  const label = categoryLabel(chipKey);
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
      return '#B98551';
    case 'walk_reminder':
      return '#7A9B70';
    case 'post_walk_debrief':
      return '#8AA1A9';
    case 'gus_intro':
      return '#BC8F65';
    default:
      return null;
  }
}

function categoryLabel(category: Exclude<FiringCategory, null>): string {
  switch (category) {
    case 'gus_intro':
      return 'Welcome';
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
  screen: { flex: 1, backgroundColor: '#F4ECE1' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4ECE1' },
  header: {
    backgroundColor: '#F7EFE5',
    borderBottomLeftRadius: 21,
    borderBottomRightRadius: 21,
    shadowColor: '#D1C0AC',
    shadowOpacity: 0.85,
    shadowRadius: 10.5,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
    zIndex: 2,
  },
  backButton: {
    position: 'absolute',
    left: 22,
    top: 36,
    width: 65,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#C89566',
    borderWidth: 1,
    borderColor: '#F7EFE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  backArrow: {
    color: '#FFFFFF',
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '800',
    marginTop: -2,
  },
  headerTitle: {
    alignSelf: 'center',
    marginTop: 24,
    marginLeft: 54,
    color: '#000000',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
  errorBanner: {
    marginHorizontal: 14,
    marginTop: 16,
    padding: 12,
    borderRadius: 19,
    backgroundColor: '#F0E4D4',
    borderWidth: 1,
    borderColor: '#BC8F65',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  errorText: { flex: 1, color: '#6B3F24', fontSize: 13, lineHeight: 18 },
  retryButton: { paddingHorizontal: 8, paddingVertical: 6 },
  retryText: { color: '#6B3F24', fontWeight: '800' },
  messageList: {
    paddingTop: 42,
    paddingBottom: 28,
    paddingHorizontal: 13,
    gap: 16,
  },
  emptyMessageList: { flexGrow: 1, justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#000000', marginBottom: 4 },
  emptyText: { color: '#5A5148', fontSize: 14 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start' },
  userRow: { justifyContent: 'flex-end' },
  gusRow: { justifyContent: 'flex-start' },
  avatarRing: {
    width: 67,
    height: 67,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: '#C89566',
    backgroundColor: '#F7EFE5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  avatarImage: {
    width: 51,
    height: 51,
  },
  bubble: {
    maxWidth: '74%',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  userBubble: {
    backgroundColor: '#BC8F65',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 0,
    marginRight: 10,
  },
  gusBubble: {
    backgroundColor: '#F0E4D4',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 32,
  },
  messageText: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  userText: { color: '#F7EFE5' },
  gusText: { color: '#000000' },
  quickReplies: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickReplyButton: {
    borderWidth: 1,
    borderColor: '#BC8F65',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F7EFE5',
  },
  quickReplyButtonDisabled: {
    opacity: 0.45,
  },
  quickReplyText: {
    color: '#6B3F24',
    fontSize: 13,
    fontWeight: '800',
  },
  selectedReplyRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedReplyLabel: {
    color: '#6B3F24',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  selectedReplyPill: {
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#BC8F65',
  },
  selectedReplyText: { color: '#F7EFE5', fontSize: 13, fontWeight: '800' },
  messageHeader: {
    fontSize: 11,
    fontWeight: '800',
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
    color: '#F7EFE5',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  gusHeader: { color: '#7B6A58' },
  userHeader: { color: '#F7EFE5', opacity: 0.85 },
  timestamp: { marginTop: 5, fontSize: 11, alignSelf: 'flex-end' },
  userTimestamp: { color: '#F7EFE5', opacity: 0.7 },
  gusTimestamp: { color: '#7B6A58' },
  thinkingBubble: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { color: '#5A5148', fontSize: 14 },
  composer: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    minHeight: 114,
    paddingTop: 24,
    paddingHorizontal: 13,
    backgroundColor: '#F7EFE5',
    borderTopLeftRadius: 21,
    borderTopRightRadius: 21,
    shadowColor: '#D2C1B1',
    shadowOpacity: 0.9,
    shadowRadius: 10.5,
    shadowOffset: { width: 0, height: -8 },
    elevation: 14,
  },
  input: {
    flex: 1,
    minHeight: 70,
    maxHeight: 118,
    borderRadius: 19,
    paddingHorizontal: 20,
    paddingVertical: 20,
    fontSize: 18,
    lineHeight: 22,
    color: '#000000',
    backgroundColor: '#F0E4D4',
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 65,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#C89566',
    borderWidth: 1,
    borderColor: '#F7EFE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.45 },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 38,
    lineHeight: 42,
    marginTop: -4,
  },
});
