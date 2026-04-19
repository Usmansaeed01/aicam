# TFLite Model Files

Drop your `.tflite` model files into this directory before running EAS Build.

## Required Models

| File | Mode | Purpose |
|---|---|---|
| `zero_dce.tflite` | PHOTO | Zero-DCE low-light enhancement model |
| `selfie_segmentation.tflite` | PORTRAIT | MediaPipe Selfie Segmentation model |

## Recommended Sources

- **zero_dce.tflite** — Zero-DCE (Zero-Reference Deep Curve Estimation):
  - Official repo: https://github.com/Li-Chongyi/Zero-DCE
  - TFLite Hub: https://tfhub.dev/sayannath/zero-dce/1
  - Input: [1, H, W, 3] float32 (normalized 0–1)
  - Output: [1, H, W, 3] float32 (enhanced, normalized 0–1)

- **selfie_segmentation.tflite** — MediaPipe Selfie Segmentation:
  - Official: https://developers.google.com/mediapipe/solutions/vision/image_segmenter
  - TFLite Hub: https://tfhub.dev/mediapipe/tfite/selfie_segmentation/1
  - Input: [1, 256, 256, 3] float32 (normalized 0–1)
  - Output: [1, 256, 256, 1] float32 (confidence mask 0–1)

## Input Format Notes

Both models expect float32 tensors with values normalized to [0.0, 1.0].
The `useTFLite` hook handles uint8 → float32 conversion automatically.

## EAS Build Note

These files are bundled into the native binary at build time via Metro's asset bundler.
`require('./assets/models/zero_dce.tflite')` resolves correctly in EAS builds.
Do NOT gitignore this directory — the .tflite files must be present before `eas build`.
