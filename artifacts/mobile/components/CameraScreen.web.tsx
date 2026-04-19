import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from "react-native";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

type CameraMode = "RETRO" | "PHOTO" | "PORTRAIT" | "VIDEO";

const MODES: CameraMode[] = ["RETRO", "PHOTO", "PORTRAIT", "VIDEO"];

export default function CameraScreen() {
  const [mode, setMode] = useState<CameraMode>("PHOTO");
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");
  const [showGrid, setShowGrid] = useState(false);

  const flashIcon =
    flash === "off" ? "flash-off" : flash === "on" ? "flash" : "flash-auto";

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      <View style={styles.preview}>
        <View style={styles.gradientTop} />
        <View style={styles.cameraBadge}>
          <MaterialCommunityIcons name="camera-wireless" size={34} color="#FFD60A" />
          <Text style={styles.badgeTitle}>AI Camera Preview</Text>
          <Text style={styles.badgeText}>
            The live camera and AI frame processors run on iOS/Android native builds.
          </Text>
        </View>
        {showGrid && <GridOverlay />}
        <View style={styles.focusSquare} />
      </View>

      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => setFlash((p) => (p === "off" ? "on" : p === "on" ? "auto" : "off"))}>
          <MaterialCommunityIcons name={flashIcon as any} size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="timer-outline" size={22} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.iconButton, showGrid && styles.iconActive]} onPress={() => setShowGrid((p) => !p)}>
          <Feather name="grid" size={21} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton}>
          <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.bottomPanel}>
        <View style={styles.modeRow}>
          {MODES.map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.modePill, mode === item && styles.modePillActive]}
              onPress={() => setMode(item)}
            >
              <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>
                {item}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.thumbnail}>
            <Ionicons name="sparkles" size={20} color="#FFD60A" />
          </View>
          <TouchableOpacity style={[styles.shutter, mode === "VIDEO" && styles.videoShutter]}>
            <View style={[styles.shutterInner, mode === "VIDEO" && styles.videoShutterInner]} />
          </TouchableOpacity>
          <View style={styles.thumbnail}>
            <Ionicons name="images-outline" size={20} color="#fff" />
          </View>
        </View>
      </View>
    </View>
  );
}

function GridOverlay() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.gridLineV, { left: "33.333%" }]} />
      <View style={[styles.gridLineV, { left: "66.666%" }]} />
      <View style={[styles.gridLineH, { top: "33.333%" }]} />
      <View style={[styles.gridLineH, { top: "66.666%" }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  preview: {
    flex: 1,
    backgroundColor: "#111",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  gradientTop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#141414",
  },
  cameraBadge: {
    width: 250,
    borderRadius: 28,
    padding: 24,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  badgeTitle: {
    marginTop: 14,
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  badgeText: {
    marginTop: 10,
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  focusSquare: {
    position: "absolute",
    width: 76,
    height: 76,
    borderWidth: 2,
    borderColor: "#FFD60A",
    borderRadius: 8,
    opacity: 0.85,
  },
  topBar: {
    position: "absolute",
    top: 54,
    left: 18,
    right: 18,
    height: 46,
    borderRadius: 24,
    backgroundColor: "rgba(0,0,0,0.42)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: {
    backgroundColor: "rgba(255,214,10,0.22)",
  },
  bottomPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 18,
    paddingBottom: 34,
    backgroundColor: "rgba(0,0,0,0.86)",
  },
  modeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 10,
  },
  modePill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  modePillActive: {
    backgroundColor: "rgba(255,214,10,0.18)",
  },
  modeText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  modeTextActive: {
    color: "#FFD60A",
  },
  controlsRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#fff",
  },
  videoShutter: {
    borderColor: "#ff453a",
  },
  videoShutterInner: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#ff453a",
  },
  gridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  gridLineH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
});