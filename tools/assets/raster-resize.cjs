'use strict';

const coefficientScale = 1 << 22;
const roundingOffset = coefficientScale / 2;
const clipByte = value => Math.max(0, Math.min(255, value));

function lanczosCoefficients(sourceSize, outputSize) {
  const scale = sourceSize / outputSize;
  const filterScale = Math.max(scale, 1);
  const support = 3 * filterScale;
  const coefficients = [];
  for (let output = 0; output < outputSize; output++) {
    const center = (output + 0.5) * scale;
    const start = Math.max(0, Math.floor(center - support + 0.5));
    const end = Math.min(sourceSize, Math.floor(center + support + 0.5));
    const weights = [];
    let total = 0;
    for (let input = start; input < end; input++) {
      const position = (input - center + 0.5) / filterScale;
      const radians = Math.PI * position;
      const weight = position === 0 ? 1 : Math.abs(position) >= 3 ? 0
        : Math.sin(radians) / radians * Math.sin(radians / 3) / (radians / 3);
      weights.push(weight);
      total += weight;
    }
    coefficients.push({ start, weights: weights.map(weight => {
      const fixed = weight / total * coefficientScale;
      return Math.trunc(fixed + (fixed < 0 ? -0.5 : 0.5));
    }) });
  }
  return coefficients;
}

// The factory and decoration art was approved after an 8-bit, two-pass Lanczos
// resize. Preserve its coefficient precision, per-pass rounding and alpha
// premultiplication here; a float pipeline changes the approved pixels slightly.
// Sharp remains responsible for decoding and encoding the source PNGs.
function resizeRgbaLanczos(source, sourceWidth, sourceHeight, width, height) {
  const pixels = Buffer.from(source);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = Math.floor((pixels[offset + channel] * alpha + 127) / 255);
    }
  }
  const horizontal = lanczosCoefficients(sourceWidth, width);
  const vertical = lanczosCoefficients(sourceHeight, height);
  const intermediate = Buffer.alloc(width * sourceHeight * 4);
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < width; x++) {
      const filter = horizontal[x];
      for (let channel = 0; channel < 4; channel++) {
        let value = roundingOffset;
        for (let offset = 0; offset < filter.weights.length; offset++) {
          value += pixels[(y * sourceWidth + filter.start + offset) * 4 + channel] * filter.weights[offset];
        }
        intermediate[(y * width + x) * 4 + channel] = clipByte(Math.floor(value / coefficientScale));
      }
    }
  }
  for (let y = 0; y < height; y++) {
    const filter = vertical[y];
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 4; channel++) {
        let value = roundingOffset;
        for (let offset = 0; offset < filter.weights.length; offset++) {
          value += intermediate[((filter.start + offset) * width + x) * 4 + channel] * filter.weights[offset];
        }
        output[(y * width + x) * 4 + channel] = clipByte(Math.floor(value / coefficientScale));
      }
    }
  }
  for (let offset = 0; offset < output.length; offset += 4) {
    const alpha = output[offset + 3];
    if (!alpha || alpha === 255) continue;
    for (let channel = 0; channel < 3; channel++) {
      output[offset + channel] = clipByte(Math.floor(output[offset + channel] * 255 / alpha));
    }
  }
  return output;
}

module.exports = { resizeRgbaLanczos };
