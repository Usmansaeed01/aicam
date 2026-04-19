/**
 * useTFLite.ts — Complete pixel codec + TFLite inference hook.
 *
 * Pipeline per mode:
 *   PHOTO:   resize → jpeg-js decode → Float32Array → Zero-DCE → CLAHE → save
 *   PORTRAIT: resize → segment (256×256) → mask upsample → dolly bg → box blur
 *             → composite → Portrait Lighting (Natural/Studio/Stage) → save
 *
 * EAS Build only. Models must exist in assets/models/ before build.
 */

import { useCallback, useRef, useState } from "react";
import { loadTensorflowModel, TensorflowModel } from "react-native-fast-tflite";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import * as jpeg from "jpeg-js";

// ─── Model Asset References ───────────────────────────────────────────────────
const MODEL_ASSETS = {
  PHOTO: require("../assets/models/zero_dce.tflite"),
  PORTRAIT: require("../assets/models/selfie_segmentation.tflite"),
} as const;

type ModelKey = keyof typeof MODEL_ASSETS;

// ─── Dimension constants ──────────────────────────────────────────────────────
const ZDCE_H = 320;   // Zero-DCE-TF @ 320×480
const ZDCE_W = 480;
const SEG_SIZE = 256; // MediaPipe fixed input
const PORTRAIT_MAX_W = 1080;

// ─── Portrait Lighting ────────────────────────────────────────────────────────
export type PortraitLightingEffect = "natural" | "studio" | "stage";

// ─── Hook interface ───────────────────────────────────────────────────────────
export interface TFLiteHook {
  runPhotoEnhancement: (imageUri: string) => Promise<string | null>;
  runPortraitSegmentation: (
    imageUri: string,
    blurStrength?: number,
    lighting?: PortraitLightingEffect
  ) => Promise<string | null>;
  isModelLoaded: (key: ModelKey) => boolean;
  loadingModel: ModelKey | null;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pixel utilities — Hermes-compatible (no Buffer, no Node.js)
// ═══════════════════════════════════════════════════════════════════════════════

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    // @ts-ignore
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function decodeJpeg(b64: string): { data: Uint8Array; width: number; height: number } {
  const bytes = b64ToBytes(b64);
  const raw = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 512 });
  return { data: raw.data as unknown as Uint8Array, width: raw.width, height: raw.height };
}

function rgbaToFloat32(rgba: Uint8Array): Float32Array {
  const pixelCount = rgba.length / 4;
  const out = new Float32Array(pixelCount * 3);
  let oi = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    out[oi++] = rgba[i] / 255;
    out[oi++] = rgba[i + 1] / 255;
    out[oi++] = rgba[i + 2] / 255;
  }
  return out;
}

function float32ToRgba(f32: Float32Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount * 4);
  let fi = 0;
  for (let i = 0; i < pixelCount; i++) {
    out[i * 4]     = Math.min(255, Math.max(0, Math.round(f32[fi++] * 255)));
    out[i * 4 + 1] = Math.min(255, Math.max(0, Math.round(f32[fi++] * 255)));
    out[i * 4 + 2] = Math.min(255, Math.max(0, Math.round(f32[fi++] * 255)));
    out[i * 4 + 3] = 255;
  }
  return out;
}

async function saveJpeg(rgba: Uint8Array, width: number, height: number, quality = 90): Promise<string> {
  const encoded = jpeg.encode({ data: rgba, width, height }, quality);
  const b64 = bytesToB64(encoded.data);
  const outPath = `${FileSystem.cacheDirectory}ai_cam_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(outPath, b64, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return outPath;
}

async function resizeToBase64(uri: string, width: number, height: number) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width, height } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return { base64: result.base64!, width: result.width, height: result.height };
}

async function resizeProportional(uri: string, maxWidth: number) {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: maxWidth } }],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return { base64: result.base64!, width: result.width, height: result.height };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAHE — Contrast Limited Adaptive Histogram Equalization
// Simulates iPhone Deep Fusion / Smart HDR 3: extreme texture detail +
// balanced highlights/shadows via adaptive local contrast enhancement.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apply tiled CLAHE to an RGBA buffer.
 *
 * @param rgba       Raw RGBA pixel data
 * @param width      Image width
 * @param height     Image height
 * @param numTilesX  Horizontal tile count (default 8)
 * @param numTilesY  Vertical tile count (default 8)
 * @param clipLimit  Histogram clip multiplier (3.5 = moderate, 6 = aggressive)
 * @returns New RGBA Uint8Array with CLAHE applied
 */
function applyCLAHE(
  rgba: Uint8Array,
  width: number,
  height: number,
  numTilesX: number = 8,
  numTilesY: number = 8,
  clipLimit: number = 3.5
): Uint8Array {
  const result = new Uint8Array(rgba.length);
  const tileW = Math.max(1, Math.ceil(width / numTilesX));
  const tileH = Math.max(1, Math.ceil(height / numTilesY));

  // Phase 1 — Compute clipped + normalized CDF for each tile
  const tileCDFs: Uint8Array[][] = [];

  for (let ty = 0; ty < numTilesY; ty++) {
    tileCDFs[ty] = [];
    for (let tx = 0; tx < numTilesX; tx++) {
      const x0 = tx * tileW;
      const x1 = Math.min(x0 + tileW, width);
      const y0 = ty * tileH;
      const y1 = Math.min(y0 + tileH, height);
      const tilePixels = (x1 - x0) * (y1 - y0);

      // Build luminance histogram
      const hist = new Int32Array(256);
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * width + px) * 4;
          const lum = Math.min(
            255,
            Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
          );
          hist[lum]++;
        }
      }

      // Clip histogram and redistribute excess uniformly
      const clipThresh = Math.max(1, Math.round((clipLimit * tilePixels) / 256));
      let excess = 0;
      for (let b = 0; b < 256; b++) {
        if (hist[b] > clipThresh) {
          excess += hist[b] - clipThresh;
          hist[b] = clipThresh;
        }
      }
      const bonus = Math.floor(excess / 256);
      const rem = excess % 256;
      for (let b = 0; b < 256; b++) {
        hist[b] += bonus;
        if (b < rem) hist[b]++;
      }

      // Compute normalized CDF → LUT [0-255]
      const cdf = new Uint8Array(256);
      let cumsum = 0;
      for (let b = 0; b < 256; b++) {
        cumsum += hist[b];
        cdf[b] = Math.min(255, Math.round((cumsum / tilePixels) * 255));
      }
      tileCDFs[ty][tx] = cdf;
    }
  }

  // Phase 2 — Map each pixel using bilinear interpolation of 4 tile CDFs
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const pixIdx = (py * width + px) * 4;
      const r = rgba[pixIdx];
      const g = rgba[pixIdx + 1];
      const b2 = rgba[pixIdx + 2];
      const oldLum = 0.299 * r + 0.587 * g + 0.114 * b2;
      const lumIdx = Math.min(255, Math.round(oldLum));

      // Fractional tile coordinate (tile centers for correct interpolation)
      const txF = (px + 0.5) / tileW - 0.5;
      const tyF = (py + 0.5) / tileH - 0.5;
      const tx0 = Math.max(0, Math.min(numTilesX - 1, Math.floor(txF)));
      const tx1 = Math.min(numTilesX - 1, tx0 + 1);
      const ty0 = Math.max(0, Math.min(numTilesY - 1, Math.floor(tyF)));
      const ty1 = Math.min(numTilesY - 1, ty0 + 1);
      const wx = Math.max(0, Math.min(1, txF - tx0));
      const wy = Math.max(0, Math.min(1, tyF - ty0));

      // Bilinear blend of 4 tile CDFs at this luminance
      const c00 = tileCDFs[ty0][tx0][lumIdx];
      const c10 = tileCDFs[ty0][tx1][lumIdx];
      const c01 = tileCDFs[ty1][tx0][lumIdx];
      const c11 = tileCDFs[ty1][tx1][lumIdx];
      const newLum =
        c00 * (1 - wx) * (1 - wy) +
        c10 * wx * (1 - wy) +
        c01 * (1 - wx) * wy +
        c11 * wx * wy;

      // Scale RGB proportionally (preserve hue)
      if (oldLum < 1) {
        result[pixIdx]     = r;
        result[pixIdx + 1] = g;
        result[pixIdx + 2] = b2;
      } else {
        const scale = newLum / oldLum;
        result[pixIdx]     = Math.min(255, Math.round(r * scale));
        result[pixIdx + 1] = Math.min(255, Math.round(g * scale));
        result[pixIdx + 2] = Math.min(255, Math.round(b2 * scale));
      }
      result[pixIdx + 3] = rgba[pixIdx + 3]; // preserve alpha
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Portrait-mode pixel operations
// ═══════════════════════════════════════════════════════════════════════════════

function upsampleMask(
  mask: Float32Array,
  srcW: number, srcH: number,
  dstW: number, dstH: number
): Float32Array {
  const out = new Float32Array(dstW * dstH);
  const scaleX = srcW / dstW;
  const scaleY = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(srcH - 1, Math.floor(y * scaleY));
    for (let x = 0; x < dstW; x++) {
      out[y * dstW + x] = mask[srcY * srcW + Math.min(srcW - 1, Math.floor(x * scaleX))];
    }
  }
  return out;
}

function applyDollyZoom(rgba: Uint8Array, width: number, height: number, scale = 1.1): Uint8Array {
  const out = new Uint8Array(rgba.length);
  const invS = 1 / scale;
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcX = Math.min(width - 1, Math.max(0, Math.round((x - cx) * invS + cx)));
      const srcY = Math.min(height - 1, Math.max(0, Math.round((y - cy) * invS + cy)));
      const di = (y * width + x) * 4;
      const si = (srcY * width + srcX) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

function boxBlur(rgba: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const tmp = new Uint8Array(rgba.length);
  const out = new Uint8Array(rgba.length);
  const kSize = 2 * radius + 1;

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += rgba[(y * width + Math.min(width - 1, Math.max(0, k))) * 4 + ch];
      }
      for (let x = 0; x < width; x++) {
        tmp[(y * width + x) * 4 + ch] = Math.round(sum / kSize);
        sum -= rgba[(y * width + Math.max(0, x - radius)) * 4 + ch];
        sum += rgba[(y * width + Math.min(width - 1, x + radius + 1)) * 4 + ch];
      }
    }
    for (let x = 0; x < width; x++) tmp[(y * width + x) * 4 + 3] = rgba[(y * width + x) * 4 + 3];
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += tmp[(Math.min(height - 1, Math.max(0, k)) * width + x) * 4 + ch];
      }
      for (let y = 0; y < height; y++) {
        out[(y * width + x) * 4 + ch] = Math.round(sum / kSize);
        sum -= tmp[(Math.max(0, y - radius) * width + x) * 4 + ch];
        sum += tmp[(Math.min(height - 1, y + radius + 1) * width + x) * 4 + ch];
      }
    }
    for (let y = 0; y < height; y++) out[(y * width + x) * 4 + 3] = tmp[(y * width + x) * 4 + 3];
  }

  return out;
}

function compositeLayers(
  fg: Uint8Array,
  bg: Uint8Array,
  mask: Float32Array,
  threshold = 0.5
): Uint8Array {
  const result = new Uint8Array(fg.length);
  const pixelCount = fg.length / 4;
  for (let i = 0; i < pixelCount; i++) {
    const isFg = mask[i] > threshold;
    result[i * 4]     = isFg ? fg[i * 4]     : bg[i * 4];
    result[i * 4 + 1] = isFg ? fg[i * 4 + 1] : bg[i * 4 + 1];
    result[i * 4 + 2] = isFg ? fg[i * 4 + 2] : bg[i * 4 + 2];
    result[i * 4 + 3] = 255;
  }
  return result;
}

/**
 * Apply Portrait Lighting effects to a composited RGBA buffer.
 *
 * Natural: no change
 * Studio:  brighten foreground 15% (simulates off-axis softbox)
 * Stage:   background → pitch black (Apple Stage Light)
 */
function applyPortraitLighting(
  composited: Uint8Array,
  mask: Float32Array,
  lighting: PortraitLightingEffect,
  threshold = 0.5
): Uint8Array {
  if (lighting === "natural") return composited;

  const result = new Uint8Array(composited);
  const pixelCount = composited.length / 4;

  if (lighting === "stage") {
    for (let i = 0; i < pixelCount; i++) {
      if (mask[i] <= threshold) {
        result[i * 4] = 0; result[i * 4 + 1] = 0; result[i * 4 + 2] = 0;
      }
    }
  } else if (lighting === "studio") {
    for (let i = 0; i < pixelCount; i++) {
      if (mask[i] > threshold) {
        result[i * 4]     = Math.min(255, Math.round(composited[i * 4]     * 1.15));
        result[i * 4 + 1] = Math.min(255, Math.round(composited[i * 4 + 1] * 1.15));
        result[i * 4 + 2] = Math.min(255, Math.round(composited[i * 4 + 2] * 1.15));
      }
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hook
// ═══════════════════════════════════════════════════════════════════════════════

export function useTFLite(): TFLiteHook {
  const modelCache = useRef<Partial<Record<ModelKey, TensorflowModel>>>({});
  const [loadingModel, setLoadingModel] = useState<ModelKey | null>(null);
  const [loadedModels, setLoadedModels] = useState<Set<ModelKey>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const getOrLoadModel = useCallback(async (key: ModelKey): Promise<TensorflowModel | null> => {
    if (modelCache.current[key]) return modelCache.current[key]!;
    try {
      setLoadingModel(key);
      setError(null);
      const model = await loadTensorflowModel(MODEL_ASSETS[key], []);
      modelCache.current[key] = model;
      setLoadedModels((prev) => new Set([...prev, key]));
      setLoadingModel(null);
      return model;
    } catch (err) {
      setError(`Failed to load ${key}: ${err instanceof Error ? err.message : String(err)}`);
      setLoadingModel(null);
      return null;
    }
  }, []);

  // ─── PHOTO: Zero-DCE + CLAHE (Deep Fusion simulation) ───────────────────
  const runPhotoEnhancement = useCallback(async (imageUri: string): Promise<string | null> => {
    const model = await getOrLoadModel("PHOTO");
    if (!model) return null;

    try {
      // 1. Resize to model input (320×480)
      const { base64: resizedB64 } = await resizeToBase64(imageUri, ZDCE_W, ZDCE_H);

      // 2. Decode JPEG → RGBA
      const { data: rgbaData } = decodeJpeg(resizedB64);

      // 3. RGBA → Float32 [1, 320, 480, 3]
      const inputTensor = rgbaToFloat32(rgbaData);

      // 4. Zero-DCE TFLite inference (low-light enhancement)
      const outputs = model.runSync([inputTensor.buffer as ArrayBuffer]);
      const outputTensor = new Float32Array(outputs[0]);

      // 5. Float32 → RGBA
      const enhancedRgba = float32ToRgba(outputTensor, ZDCE_H * ZDCE_W);

      // 6. CLAHE — Smart HDR 3 / Deep Fusion: pulls out texture detail,
      //    balances local contrast across tiles.
      //    8×8 tiles @ clipLimit=3.5 → rich texture without haloing.
      const claheRgba = applyCLAHE(enhancedRgba, ZDCE_W, ZDCE_H, 8, 8, 3.5);

      // 7. Encode and save
      const outUri = await saveJpeg(claheRgba, ZDCE_W, ZDCE_H, 92);
      return outUri;
    } catch (err) {
      setError(`PHOTO enhancement error: ${err instanceof Error ? err.message : String(err)}`);
      return imageUri;
    }
  }, [getOrLoadModel]);

  // ─── PORTRAIT: Segmentation + Dolly blur + Portrait Lighting ────────────
  const runPortraitSegmentation = useCallback(
    async (
      imageUri: string,
      blurStrength = 21,
      lighting: PortraitLightingEffect = "natural"
    ): Promise<string | null> => {
      const model = await getOrLoadModel("PORTRAIT");
      if (!model) return null;

      try {
        // 1. Working resolution (capped for JS memory)
        const { base64: workB64, width: workW, height: workH } =
          await resizeProportional(imageUri, PORTRAIT_MAX_W);

        // 2. Decode working image → RGBA (foreground source)
        const { data: fgRgba } = decodeJpeg(workB64);

        // 3. Resize to 256×256 for model input
        const { base64: segB64 } = await resizeToBase64(imageUri, SEG_SIZE, SEG_SIZE);
        const { data: segRgba } = decodeJpeg(segB64);

        // 4. Float32 model input [1, 256, 256, 3]
        const inputTensor = rgbaToFloat32(segRgba);

        // 5. MediaPipe segmentation → confidence mask [256*256]
        const outputs = model.runSync([inputTensor.buffer as ArrayBuffer]);
        const rawMask = new Float32Array(outputs[0]);

        // 6. Upsample mask → working resolution
        const fullMask = upsampleMask(rawMask, SEG_SIZE, SEG_SIZE, workW, workH);

        // 7. Dolly zoom on background (+10% scale, center crop)
        const dollyBg = applyDollyZoom(fgRgba, workW, workH, 1.1);

        // 8. Box blur background (radius ≈ blurStrength/2)
        const blurRadius = Math.max(3, Math.floor(blurStrength / 2));
        const blurredBg = boxBlur(dollyBg, workW, workH, blurRadius);

        // 9. Composite: foreground (mask>0.5) over blurred background
        let composited = compositeLayers(fgRgba, blurredBg, fullMask, 0.5);

        // 10. Portrait Lighting effect
        composited = applyPortraitLighting(composited, fullMask, lighting, 0.5);

        // 11. Encode and save
        const outUri = await saveJpeg(composited, workW, workH, 90);
        return outUri;
      } catch (err) {
        setError(`PORTRAIT error: ${err instanceof Error ? err.message : String(err)}`);
        return imageUri;
      }
    },
    [getOrLoadModel]
  );

  return {
    runPhotoEnhancement,
    runPortraitSegmentation,
    isModelLoaded: (key) => loadedModels.has(key),
    loadingModel,
    error,
  };
}
