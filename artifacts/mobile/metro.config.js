const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Register .tflite as a known asset extension so Metro bundles the
// model files from assets/models/ into the native binary at EAS Build time.
// Without this, require('../assets/models/zero_dce.tflite') will throw.
config.resolver.assetExts.push("tflite");

module.exports = config;
