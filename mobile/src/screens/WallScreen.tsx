import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import {
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
import {
  useWallStore,
  type WallPost,
  type WallReaction,
} from '@/stores/wallStore';
import { fonts } from '@/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Wall'>;

const REACTIONS: readonly WallReaction[] = ['❤️', '😂', '👏', '🐾'];

export function WallScreen({ navigation }: Props): JSX.Element {
  const insets = useSafeAreaInsets();
  const posts = useWallStore((s) => s.posts);
  const hydrate = useWallStore((s) => s.hydrate);
  const reactToPost = useWallStore((s) => s.reactToPost);
  const addComment = useWallStore((s) => s.addComment);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const totalPaws = useMemo(
    () => posts.reduce((sum, post) => sum + post.reactions['🐾'], 0),
    [posts],
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  function submitComment(postId: string): void {
    const content = drafts[postId] ?? '';
    addComment(postId, content);
    setDrafts((prev) => ({ ...prev, [postId]: '' }));
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 18 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
          onPress={() => navigation.goBack()}
        >
          <FigmaArrow direction="back" size={32} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>The Wall</Text>
          <Text style={styles.subtitle}>{totalPaws} paw taps around the neighborhood</Text>
        </View>
      </View>

      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            draft={drafts[item.id] ?? ''}
            onDraftChange={(value) => setDrafts((prev) => ({ ...prev, [item.id]: value }))}
            onReact={(reaction) => reactToPost(item.id, reaction)}
            onSubmit={() => submitComment(item.id)}
          />
        )}
        keyboardShouldPersistTaps="handled"
      />
    </KeyboardAvoidingView>
  );
}

function PostCard({
  post,
  draft,
  onDraftChange,
  onReact,
  onSubmit,
}: {
  post: WallPost;
  draft: string;
  onDraftChange: (value: string) => void;
  onReact: (reaction: WallReaction) => void;
  onSubmit: () => void;
}): JSX.Element {
  const canSubmit = draft.trim().length > 0;
  return (
    <View style={styles.post}>
      <View style={styles.postHeader}>
        <View style={[styles.avatarRing, { borderColor: post.accent }]}>
          <Image
            source={require('../assets/onboarding/gus-avatar.png')}
            style={styles.avatar}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
        <View style={styles.postHeaderCopy}>
          <Text style={styles.dogName}>{post.dogName}</Text>
          <Text style={styles.meta}>
            with {post.ownerName} · {post.location}
          </Text>
        </View>
        <Text style={styles.time}>{formatRelativeTime(post.postedAt)}</Text>
      </View>

      <View style={[styles.statusPill, { backgroundColor: post.accent }]}>
        <Text style={styles.statusText}>{post.status}</Text>
      </View>
      <Text style={styles.body}>{post.body}</Text>

      <View style={styles.reactions}>
        {REACTIONS.map((reaction) => {
          const selected = post.myReaction === reaction;
          return (
            <Pressable
              key={reaction}
              accessibilityRole="button"
              accessibilityLabel={`React ${reaction}`}
              style={({ pressed }) => [
                styles.reaction,
                selected && styles.reactionSelected,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => onReact(reaction)}
            >
              <Text style={styles.reactionEmoji}>{reaction}</Text>
              <Text style={styles.reactionCount}>{post.reactions[reaction]}</Text>
            </Pressable>
          );
        })}
      </View>

      {post.comments.length > 0 ? (
        <View style={styles.comments}>
          {post.comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>{comment.author}</Text>
              <Text style={styles.commentText}>{comment.content}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.commentComposer}>
        <TextInput
          style={styles.commentInput}
          value={draft}
          onChangeText={onDraftChange}
          placeholder="Comment"
          placeholderTextColor="#9C9185"
          maxLength={240}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.sendButton,
            !canSubmit && styles.sendButtonDisabled,
            pressed && canSubmit && styles.buttonPressed,
          ]}
          onPress={onSubmit}
        >
          <FigmaArrow size={24} />
        </Pressable>
      </View>
    </View>
  );
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F4ECE1',
  },
  header: {
    minHeight: 118,
    borderBottomLeftRadius: 21,
    borderBottomRightRadius: 21,
    backgroundColor: '#F7EFE5',
    paddingHorizontal: 18,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#D1C0AC',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.8,
    shadowRadius: 10.5,
    elevation: 10,
    zIndex: 2,
  },
  backButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#C89566',
    borderWidth: 1,
    borderColor: '#F7EFE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  headerCopy: {
    flex: 1,
    marginLeft: 14,
  },
  title: {
    color: '#000',
    fontFamily: fonts.serif,
    fontSize: 38,
    lineHeight: 42,
  },
  subtitle: {
    marginTop: 3,
    color: '#5A5148',
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  list: {
    padding: 14,
  },
  post: {
    borderRadius: 21,
    backgroundColor: '#F7EFE5',
    padding: 14,
    marginBottom: 14,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    backgroundColor: '#FFF9F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
  },
  postHeaderCopy: {
    flex: 1,
    marginLeft: 11,
  },
  dogName: {
    color: '#000',
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
  },
  meta: {
    marginTop: 2,
    color: '#5A5148',
    fontSize: 13,
    lineHeight: 17,
  },
  time: {
    color: '#7B6A58',
    fontSize: 12,
    fontWeight: '800',
  },
  statusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 14,
  },
  statusText: {
    color: '#F7EFE5',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  body: {
    marginTop: 10,
    color: '#000',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  reactions: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reaction: {
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: '#F0E4D4',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  reactionSelected: {
    backgroundColor: '#E0C19F',
  },
  reactionEmoji: {
    fontSize: 18,
    lineHeight: 22,
    marginRight: 5,
  },
  reactionCount: {
    color: '#6B3F24',
    fontSize: 13,
    fontWeight: '800',
  },
  comments: {
    marginTop: 12,
    gap: 8,
  },
  comment: {
    borderRadius: 16,
    backgroundColor: '#F0E4D4',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  commentAuthor: {
    color: '#6B3F24',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  commentText: {
    marginTop: 2,
    color: '#000',
    fontSize: 14,
    lineHeight: 19,
  },
  commentComposer: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  commentInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 96,
    borderRadius: 16,
    backgroundColor: '#F0E4D4',
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: '#000',
    fontSize: 15,
    textAlignVertical: 'center',
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#C89566',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.42,
  },
});
