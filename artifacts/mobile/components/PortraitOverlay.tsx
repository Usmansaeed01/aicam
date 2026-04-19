import React, { useEffect, useRef } from "react";
import { StyleSheet, View, Animated, Text } from "react-native";

export function PortraitOverlay() {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View
        style={[
          styles.focusRing,
          {
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.5, 0.9],
            }),
            transform: [
              {
                scale: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.98, 1.02],
                }),
              },
            ],
          },
        ]}
      />
      <View style={styles.blurHint}>
        <Text style={styles.blurHintText}>PORTRAIT</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  focusRing: {
    width: 220,
    height: 290,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: "#FFD60A",
    position: "absolute",
  },
  blurHint: {
    position: "absolute",
    bottom: "42%",
    right: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  blurHintText: {
    color: "#FFD60A",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
});
