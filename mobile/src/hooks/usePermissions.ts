import { useEffect, useState } from 'react';
import { check, PERMISSIONS, request, RESULTS, type PermissionStatus } from 'react-native-permissions';
import { Platform } from 'react-native';

const LOCATION_PERMISSION =
  Platform.OS === 'ios'
    ? PERMISSIONS.IOS.LOCATION_ALWAYS
    : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;

const MOTION_PERMISSION = Platform.OS === 'ios' ? PERMISSIONS.IOS.MOTION : undefined;

interface PermissionState {
  location: PermissionStatus | 'unknown';
  motion: PermissionStatus | 'unknown' | 'not_required';
  loading: boolean;
  request: () => Promise<void>;
}

export function usePermissions(): PermissionState {
  const [state, setState] = useState<Omit<PermissionState, 'request'>>({
    location: 'unknown',
    motion: Platform.OS === 'ios' ? 'unknown' : 'not_required',
    loading: true,
  });

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const loc = await check(LOCATION_PERMISSION);
    const mot = MOTION_PERMISSION ? await check(MOTION_PERMISSION) : 'not_required';
    setState({ location: loc, motion: mot as PermissionStatus | 'not_required', loading: false });
  }

  async function requestAll(): Promise<void> {
    setState((s) => ({ ...s, loading: true }));
    const loc = await request(LOCATION_PERMISSION);
    let mot: PermissionStatus | 'not_required' = 'not_required';
    if (MOTION_PERMISSION) {
      mot = (await request(MOTION_PERMISSION)) as PermissionStatus;
    }
    setState({ location: loc, motion: mot, loading: false });
  }

  return { ...state, request: requestAll };
}

export { RESULTS };
