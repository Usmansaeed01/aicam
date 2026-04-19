import React, { useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import type { CameraMode } from "./CameraScreen";

const { width: SCREEN_W } = Dimensions.get("window");
const ITEM_W = 90;

interface ModeCarouselProps {
  modes: CameraMode[];
  currentMode: CameraMode;
  onModeChange: (mode: CameraMode) => void;
}

export function ModeCarousel({ modes, currentMode, onModeChange }: ModeCarouselProps) {
  const currentIndex = modes.indexOf(currentMode);

  return (
    <View style={styles.container}>
      <View style={styles.modesRow}>
        {modes.map((m, i) => {
          const isActive = m === currentMode;
          return (
            <TouchableOpacity
              key={m}
              style={styles.modeBtn}
              onPress={() => onModeChange(m)}
              activeOpacity={0.7}
            >
              <Text style={[styles.modeText, isActive && styles.modeTextActive]}>
                {m}
              </Text>
              {isActive && <View style={styles.modeDot} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingVertical: 2,
  },
  modesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  modeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: "center",
  },
  modeText: {
    fontSize: 14,
    fontWeight: "600",
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 1.2,
  },
  modeTextActive: {
    color: "#FFD60A",
    fontWeight: "700",
  },
  modeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FFD60A",
    marginTop: 4,
  },
});
