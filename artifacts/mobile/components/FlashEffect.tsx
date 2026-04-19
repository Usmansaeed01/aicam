import React, { useEffect, useRef } from "react";
import { StyleSheet, Animated, View } from "react-native";

export function FlashEffect() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.flash, { opacity }]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  flash: {
    backgroundColor: "#ffffff",
    zIndex: 999,
  },
});
