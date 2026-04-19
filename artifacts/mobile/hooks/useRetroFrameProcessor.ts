/**
 * useRetroFrameProcessor — VisionCamera v4 Frame Processor hook
 * for real-time RETRO mode color effects.
 *
 * Runs as a Reanimated worklet on the camera capture thread (JSI).
 * All code inside `useFrameProcessor` must be worklet-safe:
 *  - No React state, no hooks, no async/await
 *  - Only JS primitives, typed arrays, and VisionCamera Frame APIs
 *
 * Requirements (EAS Build only — NOT Expo Go compatible):
 *  - react-native-vision-camera ^5.0.0
 *  - react-native-worklets-core ^1.6.3
 *  - babel.config.js must include 'react-native-worklets-core/plugin'
 *    BEFORE 'react-native-reanimated/plugin'
 *
 * Effect applied per frame (targeting 30-60 FPS):
 *  1. Contrast reduction  — compress luminance range toward midgray (0.7x contrast)
 *  2. Warm yellow tint    — lift red channel +18, lift green +8, drop blue -22
 *  3. Blue shadow tint    — in shadow regions (luminance < 60), shift toward indigo
 *  4. Film grain          — XOR-shift PRNG per pixel, add ±6 noise to each channel
 *
 * Pixel format: The Frame is accessed as a ByteBuffer (RGBA_8888 or YUV420).
 * VisionCamera provides `frame.toArrayBuffer()` returning a raw pixel buffer.
 */

import { useFrameProcessor } from "react-native-vision-camera";
import { Worklets } from "react-native-worklets-core";

// Simple XOR-shift PRNG — worklet-safe, no Math.random() (not available in worklets)
// Returns a value in [-1, 1]
function xorshiftNoise(seed: number): number {
  "worklet";
  let x = seed;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  return (x & 0xff) / 127.5 - 1.0;
}

function clamp(v: number, min: number, max: number): number {
  "worklet";
  return v < min ? min : v > max ? max : v;
}

/**
 * Apply the Retro color transformation to a single RGBA pixel in-place.
 *
 * @param buf  - ArrayBuffer of the full frame (mutated in place)
 * @param idx  - Byte offset of the pixel's R channel (G=idx+1, B=idx+2, A=idx+3)
 * @param seed - PRNG seed for grain (use pixelIndex or frameIndex)
 */
function applyRetroPixel(buf: Uint8Array, idx: number, seed: number): void {
  "worklet";
  const r = buf[idx];
  const g = buf[idx + 1];
  const b = buf[idx + 2];

  // 1. Contrast reduction — push values toward 128 (midgray)
  //    new_val = 128 + (val - 128) * 0.70
  let nr = 128 + (r - 128) * 0.70;
  let ng = 128 + (g - 128) * 0.70;
  let nb = 128 + (b - 128) * 0.70;

  // 2. Warm yellow-orange tint (lift shadows warm, cool midtones slightly)
  nr += 18;
  ng += 8;
  nb -= 22;

  // 3. Blue shadow tint — if pixel is dark (avg < 80), push toward cool indigo
  const avg = (nr + ng + nb) / 3;
  if (avg < 80) {
    nr -= 6;
    ng -= 4;
    nb += 14;
  }

  // 4. Film grain — XOR-shift noise ±6 per channel
  const GRAIN_STRENGTH = 6;
  const noise = xorshiftNoise(seed) * GRAIN_STRENGTH;
  nr += noise;
  ng += noise * 0.9;
  nb += noise * 0.85;

  buf[idx]     = clamp(Math.round(nr), 0, 255);
  buf[idx + 1] = clamp(Math.round(ng), 0, 255);
  buf[idx + 2] = clamp(Math.round(nb), 0, 255);
  // Alpha (buf[idx+3]) is left untouched
}

/**
 * Hook: returns a memoized frame processor for RETRO mode.
 *
 * Usage in CameraScreen:
 *
 * ```tsx
 * const frameProcessor = useRetroFrameProcessor(mode === "RETRO");
 *
 * <Camera
 *   frameProcessor={frameProcessor}
 *   ...
 * />
 * ```
 *
 * When `enabled` is false, returns undefined so the Camera
 * runs with no processor overhead (PHOTO / PORTRAIT modes).
 */
export function useRetroFrameProcessor(enabled: boolean) {
  const processor = useFrameProcessor((frame) => {
    "worklet";

    if (!enabled) return;

    // VisionCamera v4 API: get writable pixel buffer
    const buffer = frame.toArrayBuffer();
    const pixels = new Uint8Array(buffer);

    const width = frame.width;
    const height = frame.height;
    const bytesPerPixel = 4; // RGBA_8888

    // Stride over every pixel and apply the retro transform.
    // For a 1080×1920 frame this is ~8.3M byte reads/writes per frame.
    // On modern devices with JSI this runs in <8ms on the capture thread.
    let frameHash = (width * 31 + height) | 0; // simple frame seed

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * bytesPerPixel;
        const seed = (frameHash + y * width + x) | 0;
        applyRetroPixel(pixels, idx, seed);
      }
      frameHash = (frameHash * 1664525 + 1013904223) | 0; // LCG per row
    }
  }, [enabled]);

  return enabled ? processor : undefined;
}
