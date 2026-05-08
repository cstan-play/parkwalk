import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/navigation/RootNavigator';
import { useGusStore } from '@/stores/gusStore';
import { describeApiError } from '@/util/describeApiError';

type Props = NativeStackScreenProps<RootStackParamList, 'DogProfileSetup'>;

interface TraitOption {
  id: string;
  label: string;
  hint: string;
  apply: (current: PersonalityFloats) => PersonalityFloats;
}

interface PersonalityFloats {
  warmth: number;
  verbosity: number;
  political: number;
  competitiveness: number;
}

const DEFAULT_FLOATS: PersonalityFloats = {
  warmth: 0.5,
  verbosity: 0.5,
  political: 0.2,
  competitiveness: 0.1,
};

const TRAIT_OPTIONS: TraitOption[] = [
  {
    id: 'warm',
    label: 'Warm',
    hint: 'Lead with feeling, joke is incidental.',
    apply: (c) => ({ ...c, warmth: Math.min(1, c.warmth + 0.4) }),
  },
  {
    id: 'sardonic',
    label: 'Sardonic',
    hint: 'Joke first, warmth buried.',
    apply: (c) => ({ ...c, warmth: Math.max(0, c.warmth - 0.4) }),
  },
  {
    id: 'concise',
    label: 'Concise',
    hint: 'One line, comma, done.',
    apply: (c) => ({ ...c, verbosity: Math.max(0, c.verbosity - 0.4) }),
  },
  {
    id: 'long-winded',
    label: 'Long-winded',
    hint: 'Tells the whole incident report.',
    apply: (c) => ({ ...c, verbosity: Math.min(1, c.verbosity + 0.4) }),
  },
  {
    id: 'opinionated',
    label: 'Opinionated',
    hint: 'Has views on Tuesdays, weather, the news.',
    apply: (c) => ({ ...c, political: Math.min(1, c.political + 0.5) }),
  },
  {
    id: 'smug',
    label: 'Subtly smug',
    hint: "Can't help mentioning their own walk.",
    apply: (c) => ({ ...c, competitiveness: Math.min(1, c.competitiveness + 0.6) }),
  },
];

const MAX_TRAITS = 3;

export function DogProfileSetupScreen({ navigation }: Props): JSX.Element {
  const profile = useGusStore((s) => s.profile);
  const hydrate = useGusStore((s) => s.hydrate);
  const saveProfile = useGusStore((s) => s.saveProfile);

  const [name, setName] = useState(profile?.dogName ?? 'Gus');
  const [breed, setBreed] = useState(profile?.breedCosmetic ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile) {
      void hydrate();
    }
  }, [profile, hydrate]);

  useEffect(() => {
    if (profile) {
      setName(profile.dogName);
      setBreed(profile.breedCosmetic ?? '');
    }
  }, [profile]);

  const computed = useMemo<PersonalityFloats>(() => {
    let floats = { ...DEFAULT_FLOATS };
    for (const id of picked) {
      const trait = TRAIT_OPTIONS.find((t) => t.id === id);
      if (trait) floats = trait.apply(floats);
    }
    return floats;
  }, [picked]);

  function toggle(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= MAX_TRAITS) return prev;
      next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (!name.trim()) {
      Alert.alert('Name required', "Give the dog a name. Anything goes.");
      return;
    }
    setSubmitting(true);
    try {
      await saveProfile({
        dogName: name.trim(),
        breedCosmetic: breed.trim() ? breed.trim() : null,
        ...computed,
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert('Could not save', describeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Your dog</Text>
      <Text style={styles.body}>
        Pick up to {MAX_TRAITS} traits. They shape how the dog talks. You can
        change this any time from Settings.
      </Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        maxLength={60}
      />

      <Text style={styles.label}>Breed (cosmetic)</Text>
      <TextInput
        style={styles.input}
        value={breed}
        onChangeText={setBreed}
        autoCapitalize="words"
        maxLength={60}
        placeholder="optional"
      />

      <Text style={[styles.label, { marginTop: 16 }]}>Traits ({picked.size}/{MAX_TRAITS})</Text>
      <View style={styles.traits}>
        {TRAIT_OPTIONS.map((t) => {
          const active = picked.has(t.id);
          return (
            <TouchableOpacity
              key={t.id}
              onPress={() => toggle(t.id)}
              style={[styles.trait, active ? styles.traitActive : null]}
            >
              <Text style={[styles.traitLabel, active ? styles.traitLabelActive : null]}>
                {t.label}
              </Text>
              <Text style={styles.traitHint}>{t.hint}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.preview}>
        <Text style={styles.previewLabel}>Resulting dial</Text>
        <Text style={styles.previewLine}>warmth {computed.warmth.toFixed(2)}</Text>
        <Text style={styles.previewLine}>verbosity {computed.verbosity.toFixed(2)}</Text>
        <Text style={styles.previewLine}>political {computed.political.toFixed(2)}</Text>
        <Text style={styles.previewLine}>competitiveness {computed.competitiveness.toFixed(2)}</Text>
      </View>

      <View style={styles.spacer} />
      <Button title={submitting ? 'Saving...' : 'Save'} onPress={submit} disabled={submitting} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 6 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 15, color: '#555', marginBottom: 16, lineHeight: 20 },
  label: { fontSize: 13, color: '#666', marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  traits: { gap: 8, marginTop: 8 },
  trait: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fafafa',
  },
  traitActive: { borderColor: '#000', backgroundColor: '#eef' },
  traitLabel: { fontSize: 16, fontWeight: '600' },
  traitLabelActive: { color: '#003' },
  traitHint: { fontSize: 13, color: '#666', marginTop: 2 },
  preview: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#f4f4f4',
    borderRadius: 8,
    gap: 2,
  },
  previewLabel: { fontSize: 13, color: '#666', marginBottom: 4 },
  previewLine: { fontFamily: 'Menlo', fontSize: 13, color: '#333' },
  spacer: { height: 16 },
});
