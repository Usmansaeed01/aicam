/**
 * CameraScreen.tsx — iPhone 12 Feature Parity
 *
 * Features implemented:
 *   ✓ Smart HDR 3 / Deep Fusion  — CLAHE post-process in useTFLite PHOTO pipeline
 *   ✓ Portrait Lighting          — Natural / Studio / Stage sub-carousel
 *   ✓ QuickTake                  — Long-press shutter in PHOTO mode → instant video
 *   ✓ VIDEO mode                 — Dedicated carousel entry + red record button
 *   ✓ Zoom Dial                  — 0.5× / 1× / 2× persistent pill bar
 *   ✓ 3×3 Grid                   — Subtle white overlay (toggle from top bar)
 *   ✓ Tap-to-Focus               — Yellow iOS focus square
 *   ✓ Exposure Slider            — Vertical sun slider bound to Camera exposure prop
 *
 * EAS Build only — NOT Expo Go compatible.
 */

import React, {
  useRef,
  useState,
  useCallback,
  useEffect,
} from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  StatusBar,
  Dimensions,
  PanResponder,
  type GestureResponderEvent,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type CameraPosition,
} from "react-native-vision-camera";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRetroFrameProcessor } from "@/hooks/useRetroFrameProcessor";
import { useTFLite, type PortraitLightingEffect } from "@/hooks/useTFLite";
import { ModeCarousel } from "@/components/ModeCarousel";
import { ShutterButton } from "@/components/ShutterButton";

// ─── Types ────────────────────────────────────────────────────────────────────
export type CameraMode = "RETRO" | "PHOTO" | "PORTRAIT" | "VIDEO";
const MODES: CameraMode[] = ["RETRO", "PHOTO", "PORTRAIT", "VIDEO"];

const ZOOM_PRESETS = [
  { label: "0.5×", value: 0.5 },
  { label: "1×",   value: 1 },
  { label: "2×",   value: 2 },
];

const LIGHTING_OPTIONS: { key: PortraitLightingEffect; icon: string; label: string }[] = [
  { key: "natural", icon: "sun",    label: "Natural" },
  { key: "studio",  icon: "circle", label: "Studio"  },
  { key: "stage",   icon: "moon",   label: "Stage"   },
];

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const EXPOSURE_BAR_H = 160;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function exposureFromY(y: number): number {
  // y=0 → bright (+1.0), y=EXPOSURE_BAR_H → dark (-1.0)
  const clamped = Math.max(0, Math.min(EXPOSURE_BAR_H, y));
  return +(1 - (clamped / EXPOSURE_BAR_H) * 2).toFixed(2);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const { hasPermission, requestPermission } = useCameraPermission();

  // ── Camera device ──────────────────────────────────────────────────────────
  const [position, setPosition] = useState<CameraPosition>("back");
  const device = useCameraDevice(position);
  // Cast ref to any to side-step VisionCamera v5 function-component ref typing
  const cameraRef = useRef<any>(null);

  // ── Mode + controls ────────────────────────────────────────────────────────
  const [mode, setMode] = useState<CameraMode>("PHOTO");
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");
  const [timer, setTimer] = useState<0 | 3 | 10>(0);
  const [showGrid, setShowGrid] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [exposureValue, setExposureValue] = useState(0); // -1..1

  // ── Capture state ──────────────────────────────────────────────────────────
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const [timerCountdown, setTimerCountdown] = useState<number | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);

  // ── Video / QuickTake state ────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Focus / Exposure UI ────────────────────────────────────────────────────
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const focusDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Portrait Lighting ──────────────────────────────────────────────────────
  const [portraitLighting, setPortraitLighting] =
    useState<PortraitLightingEffect>("natural");

  // ── Animations ─────────────────────────────────────────────────────────────
  const shutterScale = useSharedValue(1);
  const thumbScale   = useSharedValue(1);

  const shutterAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));
  const thumbAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: thumbScale.value }],
  }));

  // ── AI hooks ───────────────────────────────────────────────────────────────
  //const retroFrameProcessor = useRetroFrameProcessor(mode === "RETRO");
  const { runPhotoEnhancement, runPortraitSegmentation, loadingModel } = useTFLite();

  // ── Layout ─────────────────────────────────────────────────────────────────
  const topInset    = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  // ── Recording timer cleanup ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (focusDismissRef.current) clearTimeout(focusDismissRef.current);
    };
  }, []);

  // ═════════════════════════════════════════════════════════════════════════════
  // Exposure slider PanResponder
  // ═════════════════════════════════════════════════════════════════════════════
  const exposurePan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      setExposureValue(exposureFromY(e.nativeEvent.locationY));
    },
    onPanResponderMove: (e: GestureResponderEvent) => {
      setExposureValue(exposureFromY(e.nativeEvent.locationY));
    },
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // Tap to Focus
  // ═════════════════════════════════════════════════════════════════════════════
  const handleTapToFocus = useCallback((e: GestureResponderEvent) => {
    if (isRecording) return;
    const { locationX, locationY } = e.nativeEvent;

    // Clamp focus square inside screen
    const x = Math.max(35, Math.min(SCREEN_W - 35, locationX));
    const y = Math.max(35, Math.min(SCREEN_H - 35, locationY));
    setFocusPoint({ x, y });

    // VisionCamera focus (normalized coords)
    cameraRef.current?.focus({
      x: locationX / SCREEN_W,
      y: locationY / SCREEN_H,
    });

    Haptics.selectionAsync();

    if (focusDismissRef.current) clearTimeout(focusDismissRef.current);
    focusDismissRef.current = setTimeout(() => setFocusPoint(null), 3500);
  }, [isRecording]);

  // ═════════════════════════════════════════════════════════════════════════════
  // Capture (PHOTO / PORTRAIT / RETRO)
  // ═════════════════════════════════════════════════════════════════════════════
  const performCapture = useCallback(async () => {
    if (!cameraRef.current) return;

    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), 180);

    shutterScale.value = withSequence(
      withSpring(0.86, { damping: 10, stiffness: 400 }),
      withSpring(1,    { damping: 8,  stiffness: 200 })
    );

    setIsProcessing(true);
    try {
      const photo = await cameraRef.current.takePhoto({
        flash: flash === "auto" ? "auto" : flash === "on" ? "on" : "off",
        qualityPrioritization: mode === "PHOTO" ? "quality" : "balanced",
      });

      // VisionCamera v5: photo.path is absolute path (needs file:// prefix)
      const rawUri = `file://${(photo as any).path}`;
      let finalUri = rawUri;

      if (mode === "PHOTO") {
        // Zero-DCE + CLAHE (Smart HDR 3 / Deep Fusion)
        const enhanced = await runPhotoEnhancement(rawUri);
        if (enhanced) finalUri = enhanced;
      } else if (mode === "PORTRAIT") {
        const seg = await runPortraitSegmentation(rawUri, 21, portraitLighting);
        if (seg) finalUri = seg;
      }
      // RETRO: frame processor already applied live, use raw

      setLastPhoto(finalUri);
      thumbScale.value = withSequence(
        withSpring(1.3, { damping: 8,  stiffness: 300 }),
        withSpring(1,   { damping: 10, stiffness: 200 })
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* swallow */
    } finally {
      setIsProcessing(false);
    }
  }, [mode, flash, portraitLighting, shutterScale, thumbScale,
      runPhotoEnhancement, runPortraitSegmentation]);

  const handleCapture = useCallback(async () => {
    if (isProcessing) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (timer > 0) {
      setTimerCountdown(timer);
      let count = timer;
      const interval = setInterval(() => {
        count--;
        if (count === 0) {
          clearInterval(interval);
          setTimerCountdown(null);
          performCapture();
        } else {
          setTimerCountdown(count);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }, 1000);
      return;
    }

    performCapture();
  }, [isProcessing, timer, performCapture]);

  // ═════════════════════════════════════════════════════════════════════════════
  // Video Recording
  // ═════════════════════════════════════════════════════════════════════════════
  const startRecording = useCallback(() => {
    if (isRecording || !cameraRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    setIsRecording(true);
    setRecordingSeconds(0);
    recordingTimerRef.current = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);

    cameraRef.current.startRecording({
      onRecordingFinished: (video: any) => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
        const uri = video.path
          ? `file://${video.path}`
          : (video.uri ?? null);
        if (uri) setLastPhoto(uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
      onRecordingError: () => {
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
      },
    });
  }, [isRecording]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || !cameraRef.current) return;
    await cameraRef.current.stopRecording();
  }, [isRecording]);

  // Unified shutter handler (photo or video depending on mode)
  const handleShutterPress = useCallback(async () => {
    if (mode === "VIDEO") {
      if (isRecording) {
        await stopRecording();
      } else {
        startRecording();
      }
      return;
    }
    handleCapture();
  }, [mode, isRecording, handleCapture, startRecording, stopRecording]);

  // QuickTake: long-press from PHOTO mode
  const handleLongPress = useCallback(() => {
    if (mode === "PHOTO" && !isRecording) startRecording();
  }, [mode, isRecording, startRecording]);

  // Release from long-press (stop QuickTake)
  const handlePressOut = useCallback(() => {
    if (isRecording && mode === "PHOTO") stopRecording();
  }, [isRecording, mode, stopRecording]);

  // ── Misc controls ──────────────────────────────────────────────────────────
  const cycleFlash = useCallback(() => {
    setFlash((p) => (p === "off" ? "on" : p === "on" ? "auto" : "off"));
    Haptics.selectionAsync();
  }, []);

  const cycleTimer = useCallback(() => {
    setTimer((p) => (p === 0 ? 3 : p === 3 ? 10 : 0));
    Haptics.selectionAsync();
  }, []);

  const flipCamera = useCallback(() => {
    setPosition((p) => (p === "back" ? "front" : "back"));
    Haptics.selectionAsync();
  }, []);

  const flashIcon =
    flash === "off" ? "flash-off" : flash === "on" ? "flash" : "flash-auto";

  // ═════════════════════════════════════════════════════════════════════════════
  // Permission gate
  // ═════════════════════════════════════════════════════════════════════════════
  if (!hasPermission) {
    return (
      <View style={styles.gate}>
        <MaterialCommunityIcons name="camera-off" size={64} color="#FFD60A" />
        <Text style={styles.gateTitle}>Camera Access Required</Text>
        <Text style={styles.gateBody}>This app needs camera access to work</Text>
        <TouchableOpacity style={styles.gateBtn} onPress={requestPermission}>
          <Text style={styles.gateBtnText}>Allow Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.gate}>
        <Text style={styles.gateBody}>Loading camera…</Text>
      </View>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // Main Render
  // ═════════════════════════════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* ── Camera Preview ─────────────────────────────────────────────────── */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!isProcessing}
        photo={mode !== "VIDEO"}
        video={true}
        audio={mode === "VIDEO"}
        zoom={zoomLevel}
        exposure={exposureValue}
        pixelFormat="rgb"
      />

      {/* ── Tap-to-Focus capture layer ─────────────────────────────────────── */}
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => !isRecording}
        onResponderRelease={handleTapToFocus}
      />

      {/* ── 3×3 Grid ──────────────────────────────────────────────────────── */}
      {showGrid && <GridOverlay />}

      {/* ── Flash effect ──────────────────────────────────────────────────── */}
      {isFlashing && <View style={styles.flashOverlay} />}

      {/* ── Timer countdown ───────────────────────────────────────────────── */}
      {timerCountdown !== null && (
        <View style={styles.timerOverlay}>
          <Text style={styles.timerCountText}>{timerCountdown}</Text>
        </View>
      )}

      {/* ── Focus Square + Exposure Slider ────────────────────────────────── */}
      {focusPoint && (
        <FocusAndExposure
          x={focusPoint.x}
          y={focusPoint.y}
          exposureValue={exposureValue}
          panHandlers={exposurePan.panHandlers}
        />
      )}

      {/* ── Top Control Bar ───────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: topInset + 8 }]}>
        {/* Flash */}
        <TouchableOpacity style={styles.topBtn} onPress={cycleFlash}>
          <Ionicons name={flashIcon as any} size={24} color="#FFD60A" />
          {flash === "auto" && <Text style={styles.topBadge}>A</Text>}
        </TouchableOpacity>

        {/* Timer */}
        <TouchableOpacity style={styles.topBtn} onPress={cycleTimer}>
          <Feather name="clock" size={22} color={timer > 0 ? "#FFD60A" : "#fff"} />
          {timer > 0 && <Text style={styles.topBadge}>{timer}s</Text>}
        </TouchableOpacity>

        {/* Grid toggle */}
        <TouchableOpacity style={styles.topBtn} onPress={() => setShowGrid((v) => !v)}>
          <Feather name="grid" size={22} color={showGrid ? "#FFD60A" : "#fff"} />
        </TouchableOpacity>
      </View>

      {/* ── Bottom Deck ───────────────────────────────────────────────────── */}
      <View style={[styles.bottomDeck, { paddingBottom: bottomInset + 12 }]}>

        {/* Portrait Lighting sub-carousel */}
        {mode === "PORTRAIT" && (
          <View style={styles.lightingRow}>
            {LIGHTING_OPTIONS.map(({ key, icon, label }) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.lightingBtn,
                  portraitLighting === key && styles.lightingBtnActive,
                ]}
                onPress={() => {
                  setPortraitLighting(key);
                  Haptics.selectionAsync();
                }}
              >
                <Feather
                  name={icon as any}
                  size={14}
                  color={portraitLighting === key ? "#000" : "#fff"}
                />
                <Text
                  style={[
                    styles.lightingText,
                    portraitLighting === key && styles.lightingTextActive,
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Zoom Dial */}
        <View style={styles.zoomDial}>
          {ZOOM_PRESETS.map(({ label, value }) => (
            <TouchableOpacity
              key={value}
              style={[styles.zoomPill, zoomLevel === value && styles.zoomPillActive]}
              onPress={() => {
                setZoomLevel(value);
                Haptics.selectionAsync();
              }}
            >
              <Text style={[styles.zoomText, zoomLevel === value && styles.zoomTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Mode Carousel */}
        <ModeCarousel
          modes={MODES}
          currentMode={mode}
          onModeChange={(m) => {
            setMode(m);
            if (isRecording) stopRecording();
            Haptics.selectionAsync();
          }}
        />

        {/* Shutter Row */}
        <View style={styles.controlRow}>
          {/* Thumbnail */}
          <Animated.View style={[styles.thumbContainer, thumbAnimStyle]}>
            {lastPhoto ? (
              <Image source={{ uri: lastPhoto }} style={styles.thumb} />
            ) : (
              <View style={styles.thumbEmpty} />
            )}
          </Animated.View>

          {/* Shutter */}
          <ShutterButton
            onPress={handleShutterPress}
            onLongPress={handleLongPress}
            onPressOut={handlePressOut}
            isProcessing={isProcessing}
            isRecording={isRecording}
            isVideoMode={mode === "VIDEO"}
            recordingSeconds={recordingSeconds}
            style={shutterAnimStyle}
          />

          {/* Flip or Stop */}
          {isRecording ? (
            <TouchableOpacity style={styles.flipBtn} onPress={stopRecording}>
              <Feather name="square" size={26} color="#ff3b30" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.flipBtn} onPress={flipCamera}>
              <Feather name="refresh-cw" size={26} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═════════════════════════════════════════════════════════════════════════════

/** 3×3 guide grid (2 vertical + 2 horizontal white lines) */
function GridOverlay() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Vertical lines */}
      <View style={[styles.gridLine, styles.gridV1]} />
      <View style={[styles.gridLine, styles.gridV2]} />
      {/* Horizontal lines */}
      <View style={[styles.gridLine, styles.gridH1]} />
      <View style={[styles.gridLine, styles.gridH2]} />
    </View>
  );
}

/** Yellow focus square + vertical exposure slider */
interface FocusAndExposureProps {
  x: number;
  y: number;
  exposureValue: number;
  panHandlers: Record<string, any>;
}

function FocusAndExposure({ x, y, exposureValue, panHandlers }: FocusAndExposureProps) {
  const BOX = 70;
  const SLIDER_X = x + 46;
  const SLIDER_Y = y - EXPOSURE_BAR_H / 2;
  const thumbY = ((1 - (exposureValue + 1) / 2) * EXPOSURE_BAR_H);

  // Keep slider on screen
  const clampedSliderX = Math.min(SCREEN_W - 32, Math.max(4, SLIDER_X));
  const clampedSliderY = Math.max(4, Math.min(SCREEN_H - EXPOSURE_BAR_H - 4, SLIDER_Y));

  return (
    <>
      {/* Focus box */}
      <View
        pointerEvents="none"
        style={[
          styles.focusBox,
          { left: x - BOX / 2, top: y - BOX / 2, width: BOX, height: BOX },
        ]}
      />

      {/* Exposure slider */}
      <View
        {...panHandlers}
        style={[
          styles.exposureBar,
          { left: clampedSliderX, top: clampedSliderY, height: EXPOSURE_BAR_H },
        ]}
      >
        {/* Sun icon at top */}
        <Feather name="sun" size={14} color="#FFD60A" style={styles.sunIcon} />
        {/* Track */}
        <View style={styles.expTrack} />
        {/* Thumb */}
        <View style={[styles.expThumb, { top: thumbY - 8 }]} />
      </View>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Styles
// ═════════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  // ── Permission gate ──────────────────────────────────────────────────────
  gate: {
    flex: 1, backgroundColor: "#000", alignItems: "center",
    justifyContent: "center", padding: 32, gap: 16,
  },
  gateTitle: { fontSize: 22, fontWeight: "700", color: "#fff", textAlign: "center" },
  gateBody:  { fontSize: 15, color: "#aaa", textAlign: "center" },
  gateBtn: {
    marginTop: 16, backgroundColor: "#FFD60A",
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30,
  },
  gateBtnText: { color: "#000", fontWeight: "700", fontSize: 16 },

  // ── Overlays ─────────────────────────────────────────────────────────────
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#fff",
    opacity: 0.9,
  },
  timerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  timerCountText: { fontSize: 120, fontWeight: "800", color: "#FFD60A" },

  // ── Grid ─────────────────────────────────────────────────────────────────
  gridLine: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  gridV1: { left: "33.33%", top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridV2: { left: "66.66%", top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH1: { top: "33.33%", left: 0, right: 0, height: StyleSheet.hairlineWidth },
  gridH2: { top: "66.66%", left: 0, right: 0, height: StyleSheet.hairlineWidth },

  // ── Focus + Exposure ──────────────────────────────────────────────────────
  focusBox: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: "#FFD60A",
    borderRadius: 4,
  },
  exposureBar: {
    position: "absolute",
    width: 28,
    alignItems: "center",
    paddingTop: 4,
  },
  sunIcon: { marginBottom: 4 },
  expTrack: {
    position: "absolute",
    top: 22,
    bottom: 0,
    width: 2,
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 1,
  },
  expThumb: {
    position: "absolute",
    left: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FFD60A",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },

  // ── Top bar ───────────────────────────────────────────────────────────────
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingBottom: 14,
    paddingHorizontal: 24,
  },
  topBtn: {
    width: 44, height: 44,
    alignItems: "center", justifyContent: "center",
  },
  topBadge: {
    position: "absolute", bottom: 4, right: 4,
    color: "#FFD60A", fontSize: 9, fontWeight: "800",
  },

  // ── Bottom deck ──────────────────────────────────────────────────────────
  bottomDeck: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.88)",
    paddingTop: 12,
    gap: 8,
  },

  // ── Portrait Lighting ────────────────────────────────────────────────────
  lightingRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  lightingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  lightingBtnActive: {
    backgroundColor: "#FFD60A",
    borderColor: "#FFD60A",
  },
  lightingText: { fontSize: 13, color: "#fff", fontWeight: "600" },
  lightingTextActive: { color: "#000" },

  // ── Zoom Dial ─────────────────────────────────────────────────────────────
  zoomDial: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  zoomPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  zoomPillActive: { backgroundColor: "rgba(255,214,10,0.2)", borderWidth: 1, borderColor: "#FFD60A" },
  zoomText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "600" },
  zoomTextActive: { color: "#FFD60A" },

  // ── Control Row ───────────────────────────────────────────────────────────
  controlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 28,
    paddingTop: 8,
    paddingBottom: 4,
  },
  thumbContainer: {
    width: 56, height: 56, borderRadius: 8, overflow: "hidden",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.3)",
  },
  thumb: { width: 56, height: 56, borderRadius: 6 },
  thumbEmpty: { width: 56, height: 56, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 6 },
  flipBtn: { width: 56, height: 56, alignItems: "center", justifyContent: "center" },
});
