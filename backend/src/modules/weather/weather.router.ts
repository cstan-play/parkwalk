import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../../middleware/asyncHandler.js';
import { authenticate } from '../../middleware/auth.js';
import { getReverseGeocode, getWeatherSnapshot } from '../../services/weather.js';

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export function buildWeatherRouter(): Router {
  const router = Router();

  router.use(authenticate);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'lat and lng are required as numeric query params' });
        return;
      }
      const { lat, lng } = parsed.data;
      const [snapshot, location] = await Promise.all([
        getWeatherSnapshot(lat, lng),
        getReverseGeocode(lat, lng),
      ]);
      res.json({
        description: snapshot.description,
        raw: snapshot.raw,
        location,
        coords: { lat, lng },
      });
    }),
  );

  return router;
}
