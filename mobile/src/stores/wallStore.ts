import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type WallReaction = '❤️' | '😂' | '👏' | '🐾';

export interface WallComment {
  id: string;
  author: 'You';
  content: string;
  createdAt: string;
}

export interface WallPost {
  id: string;
  dogName: string;
  ownerName: string;
  location: string;
  postedAt: string;
  body: string;
  status: string;
  accent: string;
  reactions: Record<WallReaction, number>;
  myReaction: WallReaction | null;
  comments: WallComment[];
}

interface WallStoreState {
  hydrated: boolean;
  posts: WallPost[];
  hydrate: () => Promise<void>;
  reactToPost: (postId: string, reaction: WallReaction) => void;
  addComment: (postId: string, content: string) => void;
}

const STORAGE_KEY = 'parkwalk.wall.v1';

const REACTIONS: readonly WallReaction[] = ['❤️', '😂', '👏', '🐾'];

const SEEDED_POSTS: WallPost[] = [
  {
    id: 'mochi-bakery',
    dogName: 'Mochi',
    ownerName: 'Liv',
    location: 'near the bakery corner',
    postedAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    body: 'Reporting live from the warm bread zone. Liv says we are “just passing by.” I have filed a formal disagreement.',
    status: 'Bread patrol',
    accent: '#BC8F65',
    reactions: { '❤️': 4, '😂': 2, '👏': 1, '🐾': 8 },
    myReaction: null,
    comments: [
      {
        id: 'seed-comment-1',
        author: 'You',
        content: 'Gus respects the investigation.',
        createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
      },
    ],
  },
  {
    id: 'bruno-park',
    dogName: 'Bruno',
    ownerName: 'Mateo',
    location: 'under the big park tree',
    postedAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    body: 'Found a stick with seniority. Too important to carry home, too important to leave. Mateo is pretending this is simple.',
    status: 'Stick custody',
    accent: '#7A9B70',
    reactions: { '❤️': 6, '😂': 5, '👏': 2, '🐾': 11 },
    myReaction: null,
    comments: [],
  },
  {
    id: 'nala-lamppost',
    dogName: 'Nala',
    ownerName: 'Sara',
    location: 'by the blue lamppost',
    postedAt: new Date(Date.now() - 1000 * 60 * 67).toISOString(),
    body: 'New messages on the lamppost. Some drama, some rain, one frankly ambitious squirrel claim. Sara gave me two minutes.',
    status: 'News desk',
    accent: '#8AA1A9',
    reactions: { '❤️': 3, '😂': 1, '👏': 4, '🐾': 9 },
    myReaction: null,
    comments: [],
  },
];

export const useWallStore = create<WallStoreState>((set, get) => ({
  hydrated: false,
  posts: SEEDED_POSTS,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        set({ posts: normalizePosts(JSON.parse(raw)), hydrated: true });
        return;
      }
    } catch {
      // Corrupt local Wall data should never block the community screen.
    }
    set({ posts: SEEDED_POSTS, hydrated: true });
  },

  reactToPost: (postId, reaction) => {
    set((state) => {
      const posts = state.posts.map((post) => {
        if (post.id !== postId) return post;
        const reactions = { ...post.reactions };
        if (post.myReaction) {
          reactions[post.myReaction] = Math.max(0, reactions[post.myReaction] - 1);
        }
        const myReaction = post.myReaction === reaction ? null : reaction;
        if (myReaction) {
          reactions[myReaction] += 1;
        }
        return { ...post, reactions, myReaction };
      });
      void persist(posts);
      return { posts };
    });
  },

  addComment: (postId, content) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    set((state) => {
      const posts = state.posts.map((post) =>
        post.id === postId
          ? {
              ...post,
              comments: [
                ...post.comments,
                {
                  id: `${postId}-${Date.now()}`,
                  author: 'You' as const,
                  content: trimmed,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : post,
      );
      void persist(posts);
      return { posts };
    });
  },
}));

function normalizePosts(value: unknown): WallPost[] {
  if (!Array.isArray(value)) return SEEDED_POSTS;
  const byId = new Map(SEEDED_POSTS.map((post) => [post.id, post]));
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const seeded = byId.get(item.id);
    if (!seeded) continue;
    byId.set(item.id, {
      ...seeded,
      reactions: normalizeReactions(item.reactions, seeded.reactions),
      myReaction: isReaction(item.myReaction) ? item.myReaction : null,
      comments: normalizeComments(item.comments),
    });
  }
  return [...byId.values()];
}

function normalizeReactions(
  value: unknown,
  fallback: Record<WallReaction, number>,
): Record<WallReaction, number> {
  const next = { ...fallback };
  if (!isRecord(value)) return next;
  for (const reaction of REACTIONS) {
    const count = value[reaction];
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
      next[reaction] = Math.round(count);
    }
  }
  return next;
}

function normalizeComments(value: unknown): WallComment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((comment) => {
    if (!isRecord(comment) || typeof comment.content !== 'string') return [];
    return [
      {
        id: typeof comment.id === 'string' ? comment.id : `comment-${Date.now()}`,
        author: 'You' as const,
        content: comment.content,
        createdAt:
          typeof comment.createdAt === 'string' ? comment.createdAt : new Date().toISOString(),
      },
    ];
  });
}

function isReaction(value: unknown): value is WallReaction {
  return typeof value === 'string' && REACTIONS.includes(value as WallReaction);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function persist(posts: WallPost[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
  } catch {
    // Wall reactions/comments are local affordances; persistence failure is non-fatal.
  }
}
