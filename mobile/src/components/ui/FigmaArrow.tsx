import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type ArrowDirection = 'forward' | 'back';

interface Props {
  color?: string;
  direction?: ArrowDirection;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function FigmaArrow({
  color = '#FFFFFF',
  direction = 'forward',
  size = 30,
  style,
}: Props): JSX.Element {
  const stroke = Math.max(3, Math.round(size * 0.16));
  const rotation = direction === 'back' ? '-135deg' : '-45deg';
  return (
    <View
      pointerEvents="none"
      style={[
        styles.root,
        {
          width: size,
          height: size,
          transform: [{ rotate: rotation }],
        },
        style,
      ]}
    >
      <View
        style={[
          styles.stem,
          {
            left: size * 0.14,
            top: (size - stroke) / 2,
            width: size * 0.62,
            height: stroke,
            borderRadius: stroke / 2,
            backgroundColor: color,
          },
        ]}
      />
      <View
        style={[
          styles.head,
          {
            right: size * 0.14,
            top: (size - size * 0.34) / 2,
            width: size * 0.34,
            height: size * 0.34,
            borderTopWidth: stroke,
            borderRightWidth: stroke,
            borderColor: color,
            borderTopRightRadius: stroke / 2,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  stem: {
    position: 'absolute',
  },
  head: {
    position: 'absolute',
  },
});
