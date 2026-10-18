'use strict';

const METADATA_SCHEMA_VERSION = 2;
const tolerance = 1e-7;

function invalid(label, field, detail) {
  throw new Error('Invalid asset metadata [' + label + '] ' + field + ': ' + detail);
}

function pair(value, label, field, positive = false) {
  if (!Array.isArray(value) || value.length !== 2
    || !value.every(number => Number.isFinite(number) && (!positive || number > 0))) {
    invalid(label, field, positive ? 'expected two positive numbers' : 'expected two finite numbers');
  }
  return [...value];
}

function samePair(actual, expected, label, field) {
  if (actual === undefined) return;
  pair(actual, label, field);
  if (actual.some((value, index) => Math.abs(value - expected[index]) > tolerance * Math.max(1, Math.abs(expected[index])))) {
    invalid(label, field, JSON.stringify(actual) + ' does not match ' + JSON.stringify(expected));
  }
}

// New fields always use the final PNG coordinate system. Legacy size, anchor,
// anchorPixels, sourceCrop and draw fields retain their original units and values.
// logicalSize is the native size at the explicitly supplied pixel ratio;
// sourceSize describes the full, uncropped source image or SVG viewport.
function normalizeAssetMetadata(item, options = {}) {
  const label = options.label || item && (item.id || item.path || item.runtime || item.src) || 'unknown asset';
  if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(label, 'asset', 'expected an object');
  if (item.metadataSchemaVersion !== undefined && item.metadataSchemaVersion !== METADATA_SCHEMA_VERSION) {
    invalid(label, 'metadataSchemaVersion', 'unsupported version ' + item.metadataSchemaVersion);
  }
  if (options.anchorSpace !== 'pixels' && options.anchorSpace !== 'normalized') {
    invalid(label, 'anchorSpace', 'must explicitly be pixels or normalized');
  }
  const pixelSize = pair(options.pixelSize || item.pixelSize, label, 'pixelSize', true);
  const sourceSize = pair(options.sourceSize || item.sourceSize || item.originalSize, label, 'sourceSize', true);
  const pixelRatio = options.pixelRatio ?? item.runtimePixelRatio ?? 1;
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) invalid(label, 'pixelRatio', 'expected a positive number');
  const logicalSize = pair(options.logicalSize || item.logicalSize || pixelSize.map(value => value / pixelRatio), label, 'logicalSize', true);
  const legacyAnchor = item.anchor || item.draw && item.draw.anchor;
  const anchor = pair(legacyAnchor || (options.anchorSpace === 'pixels' ? pixelSize.map(value => value / 2) : [0.5, 0.5]), label, 'anchor');
  const anchorNormalized = options.anchorSpace === 'pixels' ? anchor.map((value, index) => value / pixelSize[index]) : anchor;
  const anchorPx = options.anchorSpace === 'pixels' ? anchor : anchor.map((value, index) => value * pixelSize[index]);
  for (const [field, expected] of Object.entries({ pixelSize, sourceSize, logicalSize, anchorPx, anchorNormalized })) {
    samePair(item[field], expected, label, field);
  }
  const normalized = { ...item, metadataSchemaVersion: METADATA_SCHEMA_VERSION,
    logicalSize, pixelSize, sourceSize, anchorPx, anchorNormalized };
  validateAssetMetadata(normalized, { label, pixelSize, sourceSize });
  return normalized;
}

function validateAssetMetadata(item, options = {}) {
  const label = options.label || item && (item.id || item.path || item.runtime || item.src) || 'unknown asset';
  if (!item || item.metadataSchemaVersion !== METADATA_SCHEMA_VERSION) {
    invalid(label, 'metadataSchemaVersion', 'expected ' + METADATA_SCHEMA_VERSION);
  }
  const pixelSize = pair(item.pixelSize, label, 'pixelSize', true);
  const sourceSize = pair(item.sourceSize, label, 'sourceSize', true);
  pair(item.logicalSize, label, 'logicalSize', true);
  const anchorPx = pair(item.anchorPx, label, 'anchorPx');
  const anchorNormalized = pair(item.anchorNormalized, label, 'anchorNormalized');
  samePair(anchorPx, anchorNormalized.map((value, index) => value * pixelSize[index]), label, 'anchorPx');
  if (options.pixelSize) samePair(pixelSize, pair(options.pixelSize, label, 'actual PNG size', true), label, 'pixelSize');
  if (options.sourceSize) samePair(sourceSize, pair(options.sourceSize, label, 'actual source size', true), label, 'sourceSize');
  if (item.sourceCrop) {
    const crop = item.sourceCrop;
    if (!Array.isArray(crop) || crop.length !== 4 || !crop.every(Number.isFinite)
      || crop[0] < 0 || crop[1] < 0 || crop[2] <= crop[0] || crop[3] <= crop[1]
      || crop[2] > sourceSize[0] || crop[3] > sourceSize[1]) {
      invalid(label, 'sourceCrop', 'expected [left, top, right, bottom] inside the full source');
    }
  }
  if (item.draw && item.draw.sourceRect) {
    const rect = item.draw.sourceRect;
    // Calibrated equipment rectangles are rounded to four decimal places.
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
      || rect[0] < -0.001 || rect[1] < -0.001 || rect[2] <= 0 || rect[3] <= 0
      || rect[0] + rect[2] > pixelSize[0] + 0.001 || rect[1] + rect[3] > pixelSize[1] + 0.001) {
      invalid(label, 'draw.sourceRect', 'expected [x, y, width, height] inside the final PNG');
    }
  }
  return item;
}

module.exports = { METADATA_SCHEMA_VERSION, normalizeAssetMetadata, validateAssetMetadata };
