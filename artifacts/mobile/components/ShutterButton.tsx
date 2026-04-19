/**
 * ShutterButton.tsx — iPhone 12-style shutter with QuickTake + VIDEO support
 *
 * States:
 *   PHOTO idle:      white ring + white disc | long-press = QuickTake
 *   VIDEO idle:      white ring + red disc   | press = start recording
 *   Recording:       red ring + stop square  | live timer badge above
 *   Processing:      spinner
 */

import React, { useEffect } from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
  Text,
  ActivityIndicator,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";

export interface ShutterButtonProps {
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
  isProcessing: boolean;
  isRecording?: boolean;
  isVideoMode?: boolean;
  recordingSeconds?: number;
  style?: any;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

export function ShutterButton({
  onPress,
  onLongPress,
  onPressOut,
  isProcessing,
  isRecording = false,
  isVideoMode = false,
  recordingSeconds = 0,
  style,
}: ShutterButtonProps) {
  const scaleAnim = useSharedValue(1);
  const borderAnim = useSharedValue(0); // 0=white 1=red

  useEffect(() => {
    scaleAnim.value = isRecording
      ? withSpring(1.1, { damping: 6, stiffness: 220 })
      : withSpring(1.0, { damping: 8, stiffness: 200 });
    borderAnim.value = isRecording
      ? withTiming(1, { duration: 180 })
      : withTiming(0, { duration: 180 });
  }, [isRecording]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleAnim.value }],
    borderColor: interpolateColor(
      borderAnim.value,
      [0, 1],
      ["#ffffff", "#ff3b30"]
    ) as string,
  }));

  if (isRecording) {
    return (
      <View style={[styles.wrapper, style]}>
        <View style={styles.recBadge}>
          <View style={styles.recDot} />
          <Text style={styles.recText}>{fmt(recordingSeconds)}</Text>
        </View>
        <Animated.View style={[styles.ring, ringStyle]}>
          <TouchableOpacity
            style={styles.innerTouch}
            onPress={onPress}
            activeOpacity={0.85}
          >
            <View style={styles.stopSquare} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  if (isVideoMode) {
    return (
      <View style={[styles.wrapper, style]}>
        <Animated.View style={[styles.ring, ringStyle]}>
          <TouchableOpacity
            style={styles.innerTouch}
            onPress={onPress}
            activeOpacity={0.85}
          >
            <View style={styles.videoDisc} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, style]}>
      <Animated.View style={[styles.ring, ringStyle]}>
        <TouchableOpacity
          style={styles.innerTouch}
          onPress={onPress}
          onLongPress={onLongPress}
          onPressOut={onPressOut}
          delayLongPress={500}
          disabled={isProcessing}
          activeOpacity={0.85}
        >
          {isProcessing ? (
            <View style={styles.spinner}>
              <ActivityIndicator color="#FFD60A" size="small" />
            </View>
          ) : (
            <View style={styles.photoDisc} />
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: "center", justifyContent: "center" },
  ring: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: "#ffffff",
    overflow: "hidden",
  },
  innerTouch: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  photoDisc: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ffffff" },
  videoDisc: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#ff3b30" },
  stopSquare: { width: 26, height: 26, borderRadius: 5, backgroundColor: "#ff3b30" },
  spinner: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  recBadge: {
    position: "absolute",
    top: -34,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,59,48,0.92)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  recText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"] as any,
  },
});
