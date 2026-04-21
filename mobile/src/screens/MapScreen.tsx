import MapboxGL from '@rnmapbox/maps';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GameEntity } from '@parkwalk/shared';

import { useIdempotencyKey } from '@/hooks/useIdempotencyKey';
import { useMovementDetection } from '@/hooks/useMovementDetection';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import { collectEntity, fetchNearby } from '@/services/entitiesApi';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'>;

export function MapScreen({ navigation }: Props): JSX.Element {
  const movement = useMovementDetection();
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const idem = useIdempotencyKey();
  const queryClient = useQueryClient();

  const centerCoords = useMemo(() => {
    if (movement.latest) {
      return [movement.latest.location.longitude, movement.latest.location.latitude];
    }
    if (lastLocation) return [lastLocation.lng, lastLocation.lat];
    return [-122.4194, 37.7749];
  }, [movement.latest, lastLocation]);

  const nearbyQuery = useQuery({
    queryKey: ['nearby', roundKey(centerCoords[1]!, centerCoords[0]!)],
    queryFn: () =>
      fetchNearby({
        lat: centerCoords[1]!,
        lng: centerCoords[0]!,
        radiusMeters: 500,
        limit: 50,
      }),
    enabled: !!movement.latest || !!lastLocation,
    refetchInterval: 30_000,
  });

  const collectMutation = useMutation({
    mutationFn: async (entity: GameEntity) => {
      if (!movement.summary || !movement.latest) {
        throw new Error('No movement summary yet; stand still for a second and try again');
      }
      const key = idem.next();
      return await collectEntity(key, {
        entityId: entity.id,
        location: movement.latest.location,
        summary: movement.summary,
        samples: movement.samples,
        clientSentAt: new Date().toISOString(),
      });
    },
    onSuccess: (_data, entity) => {
      Alert.alert('Collected!', `+${Number((entity.config as { points?: number }).points ?? 0)} points`);
      void queryClient.invalidateQueries({ queryKey: ['nearby'] });
      void queryClient.invalidateQueries({ queryKey: ['myStats'] });
    },
    onError: (err: unknown) => {
      Alert.alert('Cannot collect', describeError(err));
    },
  });

  const collectable = (entity: GameEntity): boolean => {
    if (!movement.summary || movement.summary.state !== 'WALKING_VALID') return false;
    if (typeof entity.distanceMeters !== 'number') return false;
    return entity.distanceMeters <= entity.collectionRadiusMeters;
  };

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        onDidFinishLoadingMap={() => undefined}
        logoEnabled={false}
        attributionEnabled={true}
      >
        <MapboxGL.Camera
          zoomLevel={16}
          centerCoordinate={centerCoords}
          followZoomLevel={16}
          followUserMode={MapboxGL.UserTrackingMode.Follow}
          followUserLocation={true}
        />
        <MapboxGL.UserLocation
          visible
          onUpdate={(u) => setLastLocation({ lat: u.coords.latitude, lng: u.coords.longitude })}
        />
        {(nearbyQuery.data ?? []).map((e) => (
          <MapboxGL.PointAnnotation
            key={e.id}
            id={e.id}
            coordinate={[e.location.longitude, e.location.latitude]}
            onSelected={() => {
              if (!collectable(e)) {
                Alert.alert(
                  'Not yet',
                  !movement.summary || movement.summary.state !== 'WALKING_VALID'
                    ? `Current movement state: ${movement.summary?.state ?? 'UNKNOWN'}. Keep walking.`
                    : `You're ${Math.round(e.distanceMeters ?? 0)}m away; need to be within ${e.collectionRadiusMeters}m.`,
                );
                return;
              }
              collectMutation.mutate(e);
            }}
          >
            <View style={styles.marker} />
          </MapboxGL.PointAnnotation>
        ))}
      </MapboxGL.MapView>

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          state: <Text style={styles.overlayBold}>{movement.summary?.state ?? 'UNKNOWN'}</Text>
          {'\n'}speed: {movement.summary?.averageSpeedMps.toFixed(2) ?? '0.00'} m/s
          {'\n'}entities: {nearbyQuery.data?.length ?? 0}
        </Text>
        <View style={styles.rowButtons}>
          <Button title="Stats" onPress={() => navigation.navigate('Stats')} />
          <Button title="Settings" onPress={() => navigation.navigate('Settings')} />
        </View>
      </View>
    </View>
  );
}

function roundKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

function describeError(err: unknown): string {
  if (typeof err === 'object' && err && 'response' in err) {
    const r = (err as { response?: { data?: { error?: { message?: string } } } }).response;
    return r?.data?.error?.message ?? 'Unknown error';
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  marker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3B82F6',
    borderColor: 'white',
    borderWidth: 2,
  },
  overlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    gap: 8,
  },
  overlayText: { fontSize: 13, color: '#333' },
  overlayBold: { fontWeight: '600' },
  rowButtons: { flexDirection: 'row', gap: 8 },
});
