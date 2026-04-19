import React, { useEffect, useRef } from "react";
import { StyleSheet, View, Animated } from "react-native";

export function RetroOverlay() {
  const grainAnim = useRef(new Animated.Value(0)).current;
  const vignetteAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const grainLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(grainAnim, {
          toValue: 1,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(grainAnim, {
          toValue: 0,
          duration: 80,
          useNativeDriver: true,
        }),
      ])
    );
    grainLoop.start();
    return () => grainLoop.stop();
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.warmTint} />
      <View style={styles.vignette} />
      <Animated.View
        style={[
          styles.grain,
          { opacity: grainAnim.interpolate({ inputRange: [0, 1], outputRange: [0.04, 0.09] }) },
        ]}
      />
      <View style={styles.scanlines} />
      <View style={styles.horizontalBar} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  warmTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(180, 120, 40, 0.12)",
    mixBlendMode: "multiply" as any,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 120,
    borderColor: "rgba(0,0,0,0.5)",
    borderRadius: 4,
  },
  grain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    borderWidth: 0,
    opacity: 0.06,
    backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 2px, transparent 3px)" as any,
  },
  scanlines: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.04,
    borderWidth: 0,
  },
  horizontalBar: {
    position: "absolute",
    bottom: "35%",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,220,100,0.08)",
  },
});
