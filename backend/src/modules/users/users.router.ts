import { Router } from 'express';

import { authenticate } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';
import { prisma } from '../../prisma.js';

export function buildUsersRouter(): Router {
  const router = Router();

  router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
  });

  router.get('/me/stats', authenticate, async (req, res) => {
    const stats = await prisma.userStats.findUnique({ where: { userId: req.user!.id } });
    if (!stats) throw notFound('Stats not found');
    res.json({
      stats: {
        userId: stats.userId,
        totalDistanceMeters: Number(stats.totalDistanceMeters),
        dailyDistanceMeters: Number(stats.dailyDistanceMeters),
        weeklyDistanceMeters: Number(stats.weeklyDistanceMeters),
        totalCollections: stats.totalCollections,
        dailyCollections: stats.dailyCollections,
        weeklyCollections: stats.weeklyCollections,
        treasuresPlaced: stats.treasuresPlaced,
        treasuresFoundByOthers: stats.treasuresFoundByOthers,
        totalWalkingMinutes: stats.totalWalkingMinutes,
        dailyWalkingMinutes: stats.dailyWalkingMinutes,
        currentStreakDays: stats.currentStreakDays,
        longestStreakDays: stats.longestStreakDays,
        lastActivityDate: stats.lastActivityDate
          ? stats.lastActivityDate.toISOString().slice(0, 10)
          : null,
        dailyScore: stats.dailyScore,
        weeklyScore: stats.weeklyScore,
        allTimeScore: stats.allTimeScore,
        updatedAt: stats.updatedAt.toISOString(),
      },
    });
  });

  return router;
}
