#!/usr/bin/env node
/**
 * download-models.js
 *
 * Automatically downloads and places TFLite models for the AI Camera app.
 * Run before EAS Build so Metro can bundle them.
 *
 * Usage:
 *   node artifacts/mobile/scripts/download-models.js
 *   pnpm --filter @workspace/mobile run download-models
 *
 * Models:
 *   selfie_segmentation.tflite — MediaPipe Selfie Segmentation (float16, 256×256)
 *     Source: Google Cloud Storage (MediaPipe official)
 *
 *   zero_dce.tflite — Zero-DCE-TF low-light enhancement (float32, 320×480)
 *     Source: PINTO_model_zoo 216_Zero-DCE-TF via Wasabi S3
 *     Note: TFHub/Kaggle no longer serves this without auth (post-2024 migration).
 *           PINTO's model zoo (pinto-model-zoo.wasabisys.com) is the canonical
 *           public mirror for converted TFLite models.
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

const MODELS_DIR = path.join(__dirname, "..", "assets", "models");

// ─── Model specs ─────────────────────────────────────────────────────────────

const MODELS = [
  {
    name: "selfie_segmentation.tflite",
    type: "direct",
    urls: [
      // Primary: Official Google Cloud Storage bucket
      "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
      // Fallback: alternate MediaPipe assets bucket
      "https://storage.googleapis.com/mediapipe-assets/selfie_segmenter.tflite",
    ],
    minBytes: 100_000, // ~100 KB minimum valid model
  },
  {
    name: "zero_dce.tflite",
    type: "tar",
    // PINTO model zoo — Wasabi S3 object storage
    tarUrl: "https://s3.ap-northeast-2.wasabisys.com/pinto-model-zoo/216_Zero-DCE-TF/resources.tar.gz",
    // Extract the 320×480 float32 variant (ideal 4:3 ratio for phone cameras)
    tarEntry: "saved_model_320x480/model_float32.tflite",
    minBytes: 100_000, // ~327 KB actual
  },
];

// ─── Downloader (follows all redirect types, with progress) ──────────────────

function downloadToFile(url, destPath, redirectsLeft = 10) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error("Too many redirects"));

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (e) {
      return reject(new Error(`Invalid URL: ${url}`));
    }

    const protocol = urlObj.protocol === "https:" ? https : http;
    const req = protocol.get(
      url,
      {
        headers: {
          "User-Agent": "AI-Camera-ModelDownloader/2.0 (Node.js)",
          Accept: "application/octet-stream, application/x-gzip, */*",
        },
      },
      (res) => {
        const { statusCode, headers } = res;

        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          const location = headers.location;
          if (!location) {
            res.resume();
            return reject(new Error("Redirect without Location header"));
          }
          const next = /^https?:\/\//.test(location)
            ? location
            : new URL(location, url).toString();
          process.stdout.write(`\n    ↳ ${statusCode} → ${next.slice(0, 80)}`);
          res.resume();
          downloadToFile(next, destPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode} at ${url.slice(0, 80)}`));
        }

        const ct = headers["content-type"] || "";
        if (ct.startsWith("text/html")) {
          res.resume();
          return reject(new Error("Server returned HTML (auth wall or wrong URL)"));
        }

        const file = fs.createWriteStream(destPath);
        let downloaded = 0;

        res.on("data", (chunk) => {
          downloaded += chunk.length;
          process.stdout.write(
            `\r    ${(downloaded / 1_048_576).toFixed(2)} MB received...   `
          );
        });

        res.pipe(file);

        file.on("finish", () => {
          file.close();
          process.stdout.write("\n");
          resolve(downloaded);
        });

        file.on("error", (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });

        res.on("error", (err) => {
          try { fs.unlinkSync(destPath); } catch {}
          reject(err);
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(180_000, () => {
      req.destroy(new Error("Request timed out after 180s"));
    });
  });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function downloadDirect(model) {
  const destPath = path.join(MODELS_DIR, model.name);

  for (let i = 0; i < model.urls.length; i++) {
    const url = model.urls[i];
    console.log(`  ⬇  [${i + 1}/${model.urls.length}] ${url.slice(0, 72)}...`);
    try {
      await downloadToFile(url, destPath);
      const { size } = fs.statSync(destPath);
      if (size < model.minBytes) {
        try { fs.unlinkSync(destPath); } catch {}
        console.log(`  ✗  Too small (${size} B) — not a valid model file`);
        continue;
      }
      console.log(`  ✅ Saved: ${(size / 1_048_576).toFixed(2)} MB`);
      return true;
    } catch (err) {
      try { fs.unlinkSync(destPath); } catch {}
      console.log(`  ✗  ${err.message}`);
      if (i < model.urls.length - 1) console.log("     Trying next URL...");
    }
  }
  return false;
}

async function downloadFromTar(model) {
  const destPath = path.join(MODELS_DIR, model.name);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-camera-model-"));
  const tmpTar = path.join(tmpDir, "resources.tar.gz");

  try {
    console.log(`  ⬇  Downloading archive from PINTO Wasabi S3...`);
    console.log(`     ${model.tarUrl}`);
    await downloadToFile(model.tarUrl, tmpTar);

    const tarBytes = fs.statSync(tmpTar).size;
    console.log(`  📦 Archive: ${(tarBytes / 1_048_576).toFixed(2)} MB — extracting...`);

    // Extract only the needed entry
    execSync(`tar -xzf "${tmpTar}" -C "${tmpDir}" "${model.tarEntry}"`, {
      stdio: "pipe",
    });

    const extractedPath = path.join(tmpDir, model.tarEntry);
    if (!fs.existsSync(extractedPath)) {
      throw new Error(`Entry '${model.tarEntry}' not found in archive`);
    }

    fs.copyFileSync(extractedPath, destPath);
    const { size } = fs.statSync(destPath);

    if (size < model.minBytes) {
      throw new Error(`Extracted file too small: ${size} bytes`);
    }

    console.log(`  ✅ Extracted and saved: ${(size / 1_048_576).toFixed(2)} MB`);
    return true;
  } catch (err) {
    try { fs.unlinkSync(destPath); } catch {}
    console.log(`  ✗  ${err.message}`);
    return false;
  } finally {
    // Clean up temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n┌─────────────────────────────────────────────────┐");
  console.log("│   AI Camera — TFLite Model Downloader v2.0      │");
  console.log("└─────────────────────────────────────────────────┘\n");
  console.log(`  Output: ${MODELS_DIR}\n`);

  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    console.log("  Created models directory.\n");
  }

  let allOk = true;

  for (const model of MODELS) {
    console.log(`\n── ${model.name} ${"─".repeat(Math.max(0, 48 - model.name.length))}`);

    // Skip if already valid
    const destPath = path.join(MODELS_DIR, model.name);
    if (fs.existsSync(destPath)) {
      const { size } = fs.statSync(destPath);
      if (size >= model.minBytes) {
        console.log(`  ✓  Already present (${(size / 1_048_576).toFixed(2)} MB) — skipping`);
        continue;
      }
      console.log(`  ⚠  Exists but too small (${size} B) — re-downloading`);
      fs.unlinkSync(destPath);
    }

    let ok = false;
    if (model.type === "direct") {
      ok = await downloadDirect(model);
    } else if (model.type === "tar") {
      ok = await downloadFromTar(model);
    }

    if (!ok) {
      console.error(`\n  ✗ FAILED: ${model.name}`);
      allOk = false;
    }
  }

  console.log("\n┌─────────────────────────────────────────────────┐");
  if (allOk) {
    console.log("│  ✅ All models ready — safe to run eas build     │");
    console.log("└─────────────────────────────────────────────────┘\n");
    console.log("  Final contents of assets/models/:");
    for (const f of fs.readdirSync(MODELS_DIR).filter((n) => n.endsWith(".tflite"))) {
      const { size } = fs.statSync(path.join(MODELS_DIR, f));
      console.log(`    ${f.padEnd(38)} ${(size / 1_048_576).toFixed(2)} MB`);
    }
  } else {
    console.log("│  ✗ Some downloads failed — check errors above    │");
    console.log("└─────────────────────────────────────────────────┘\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
