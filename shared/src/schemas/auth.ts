import { z } from 'zod';

import { timestampSchema, uuidSchema } from './primitives.js';

export const registerRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'Alphanumeric + underscore only'),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: timestampSchema,
  refreshTokenExpiresAt: timestampSchema,
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const authUserSchema = z.object({
  id: uuidSchema,
  username: z.string(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  createdAt: timestampSchema,
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const authResponseSchema = z.object({
  user: authUserSchema,
  tokens: tokenPairSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;
