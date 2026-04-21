import { useRef } from 'react';

/**
 * Produces a UUIDv4-ish key for the current "collection attempt". We generate
 * a new key only when the user starts a fresh collect attempt (i.e. on button
 * press), not on every render. The key is stable across retries from the
 * axios interceptor so the server returns the stored result.
 */
export function useIdempotencyKey(): { next: () => string } {
  const ref = useRef<string>('');
  return {
    next: () => {
      ref.current = uuid();
      return ref.current;
    },
  };
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
