# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### AI Camera (artifacts/mobile)

**EAS Build only — does NOT run in Expo Go** (uses JSI native modules).

iOS-style camera app with three AI-powered modes. Built for EAS custom native build.

#### Architecture

| File | Purpose |
|---|---|
| `components/CameraScreen.tsx` | Main screen: VisionCamera v5 Camera component, mode state, capture flow |
| `components/CameraScreen.web.tsx` | Web-safe preview shell that avoids importing native-only camera modules |
| `app/_layout.web.tsx` | Web-safe root layout that avoids native-only providers in browser preview |
| `hooks/useRetroFrameProcessor.ts` | GPU worklet — real-time per-frame pixel manipulation for RETRO mode |
| `hooks/useTFLite.ts` | TFLite model loader and inference runner for PHOTO + PORTRAIT modes |
| `components/ModeCarousel.tsx` | Swipeable mode selector (RETRO/PHOTO/PORTRAIT) |
| `components/ShutterButton.tsx` | Animated shutter button with spring compression |
| `components/RetroOverlay.tsx` | UI-layer retro vignette/grain overlay (visual reinforcement) |
| `components/PortraitOverlay.tsx` | Pulsing focus ring for portrait mode |
| `components/FlashEffect.tsx` | Full-screen white flash on capture |
| `assets/models/README.md` | Instructions for dropping in .tflite files |
| `metro.config.js` | Adds 'tflite' to assetExts for Metro bundling |
| `babel.config.js` | Worklets + Reanimated plugins in correct order |
| `app.json` | Expo app metadata, permissions, and Expo-managed plugins |

#### Key Packages

- `react-native-vision-camera` ^5.0.1 — camera preview + Frame Processors
- `react-native-fast-tflite` ^3.0.0 — on-device TFLite inference
- `react-native-worklets-core` ^1.6.3 — JSI worklet runtime for frame processor
- `react-native-reanimated` ~4.1.7 — spring animations (shutter, thumbnail); Babel plugin remains last
- `react-native-nitro-modules` 0.35.4 + `react-native-nitro-image` 0.13.1 — VisionCamera v5 native peer dependencies
- `expo-file-system` ~19.0.21 + `expo-image-manipulator` ~14.0.8 — Expo SDK 54-compatible image pipeline
- `jpeg-js` ^0.4.4 + `buffer` ^6.0.3 — pixel codec support
- `expo-haptics` — haptic feedback on all interactions

#### Modes

- **RETRO**: `useRetroFrameProcessor` runs as a Reanimated worklet on the camera capture thread. Per-frame: contrast reduction (0.7x), warm yellow tint (+18R/+8G/-22B), blue shadow tint, XOR-shift film grain ±6.
- **PHOTO**: `useTFLite.runPhotoEnhancement()` → loads `zero_dce.tflite`, runs [1,400,600,3] float32 inference, decodes output back to image.
- **PORTRAIT**: `useTFLite.runPortraitSegmentation()` → loads `selfie_segmentation.tflite`, 256×256 mask output, thresholds at 0.5, applies Gaussian blur (kernel=21) to background, +10% Dolly zoom scale on background layer before composite.

#### TFLite Model Drop Path

```
artifacts/mobile/assets/models/
├── zero_dce.tflite                ← PHOTO mode
└── selfie_segmentation.tflite    ← PORTRAIT mode
```

See `assets/models/README.md` for model sources and tensor specs.

#### EAS Build Steps

1. Drop .tflite files into `artifacts/mobile/assets/models/`
2. Run `eas build --platform ios --profile production` from `artifacts/mobile/`
3. Models are bundled automatically via Metro (assetExts includes 'tflite')

#### EAS Package Manager

- Mobile EAS builds use npm with `artifacts/mobile/package-lock.json`.
- Do not commit `pnpm-lock.yaml` or `yarn.lock` for the mobile EAS build package.
- React Compiler is disabled in `app.json` for EAS stability; the native camera stack does not require `react/compiler-runtime`.
