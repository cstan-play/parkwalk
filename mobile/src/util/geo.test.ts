import { haversineMeters } from './geo';

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters({ latitude: 55.676, longitude: 12.568 }, { latitude: 55.676, longitude: 12.568 })).toBe(0);
  });

  it('matches a known short distance (~111m per 0.001 deg latitude) within 1%', () => {
    const d = haversineMeters(
      { latitude: 55.676, longitude: 12.568 },
      { latitude: 55.677, longitude: 12.568 },
    );
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('is symmetric', () => {
    const a = { latitude: 55.676, longitude: 12.568 };
    const b = { latitude: 55.68, longitude: 12.57 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});
