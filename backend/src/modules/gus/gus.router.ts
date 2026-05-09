import {
  sendChatRequestSchema,
  submitQuickReplyRequestSchema,
  upsertDogProfileRequestSchema,
  upsertGusPrefsRequestSchema,
} from '@parkwalk/shared';
import { Router } from 'express';

import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { validate } from '../../middleware/validate.js';

import {
  getOrCreateDogProfile,
  getOrCreateGusPrefs,
  listGusModels,
  listMessages,
  sendUserMessage,
  submitQuickReply,
  upsertDogProfile,
  upsertGusPrefs,
} from './gus.service.js';

export function buildGusRouter(): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/profile',
    asyncHandler(async (req, res) => {
      const profile = await getOrCreateDogProfile(req.user!.id);
      res.json({ profile });
    }),
  );

  router.post(
    '/profile',
    validate(upsertDogProfileRequestSchema),
    asyncHandler(async (req, res) => {
      const profile = await upsertDogProfile(req.user!.id, req.body);
      res.json({ profile });
    }),
  );

  router.get(
    '/prefs',
    asyncHandler(async (req, res) => {
      const prefs = await getOrCreateGusPrefs(req.user!.id);
      res.json({ prefs });
    }),
  );

  router.post(
    '/prefs',
    validate(upsertGusPrefsRequestSchema),
    asyncHandler(async (req, res) => {
      const prefs = await upsertGusPrefs(req.user!.id, req.body);
      res.json({ prefs });
    }),
  );

  router.get(
    '/messages',
    asyncHandler(async (req, res) => {
      const items = await listMessages(req.user!.id);
      res.json({ items });
    }),
  );

  router.get(
    '/models',
    asyncHandler(async (_req, res) => {
      const result = await listGusModels();
      res.json(result);
    }),
  );

  router.post(
    '/chat',
    validate(sendChatRequestSchema),
    asyncHandler(async (req, res) => {
      const ownerName = req.user!.displayName ?? req.user!.username;
      const result = await sendUserMessage(req.user!.id, ownerName, req.body.content);
      res.status(201).json(result);
    }),
  );

  router.post(
    '/quickReply',
    validate(submitQuickReplyRequestSchema),
    asyncHandler(async (req, res) => {
      const ownerName = req.user!.displayName ?? req.user!.username;
      const result = await submitQuickReply(
        req.user!.id,
        ownerName,
        req.body.messageId,
        req.body.value,
      );
      res.status(201).json(result);
    }),
  );

  return router;
}
