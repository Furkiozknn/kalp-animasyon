// A minimal PNG reader, just enough to look at what Playwright screenshotted.
//
// The smoke tests need to assert that the scene actually drew light rather
// than leaving a black rectangle - the one regression that matters most here
// and the one the DOM cannot reveal. Decoding the screenshot is the only way
// to see that from outside the page: a WebGL drawing buffer is not readable
// after compositing unless the renderer opts into preserveDrawingBuffer,
// which would cost real performance in production purely to serve a test.
//
// Handles 8-bit truecolour with and without alpha, which is everything
// Playwright's PNG screenshots produce.
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');

  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length; // length + type + data + CRC
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filters. Each row is prefixed by its filter type,
  // and filters reference the pixel to the left (a), above (b) and
  // above-left (c) in already-reconstructed output.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src + x];
      const a = x >= channels ? pixels[dst + x - channels] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c = (x >= channels && y > 0) ? pixels[dst - stride + x - channels] : 0;
      let out;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + a; break;
        case 2: out = value + b; break;
        case 3: out = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          out = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown filter ${filter} on row ${y}`);
      }
      pixels[dst + x] = out & 0xff;
    }
  }

  return { width, height, channels, pixels };
}

// What the screenshot actually looks like, reduced to the few numbers the
// assertions care about.
function summarize(buffer) {
  const { width, height, channels, pixels } = decodePng(buffer);
  let brightest = 0;
  let lit = 0;          // pixels clearly above the near-black background
  let colorful = 0;     // pixels with a real hue, not just grey light
  let total = 0;

  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > brightest) brightest = max;
    if (max > 60) lit++;
    if (max > 40 && max - min > 25) colorful++;
    total++;
  }

  return {
    width,
    height,
    brightest,
    litFraction: lit / total,
    colorfulFraction: colorful / total,
  };
}

// Mean absolute per-channel difference between two screenshots, 0..255.
// Used to assert that reduced motion really does hold the scene still: two
// frames half a second apart should be all but identical.
function meanDifference(bufferA, bufferB) {
  const a = decodePng(bufferA);
  const b = decodePng(bufferB);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error('frames differ in size or format');
  }
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < a.pixels.length; i += a.channels) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(a.pixels[i + c] - b.pixels[i + c]);
      samples++;
    }
  }
  return sum / samples;
}

// Fraction of pixels that visibly changed between two screenshots.
//
// The mean above answers "how much did the whole frame move"; this answers
// "did anything appear at all". A few dozen sparks cover well under 1% of a
// 1280x720 frame, so their contribution vanishes into a whole-frame mean even
// while being obvious to the eye - counting changed pixels keeps the signal.
function changedFraction(bufferA, bufferB, threshold = 24) {
  const a = decodePng(bufferA);
  const b = decodePng(bufferB);
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) {
    throw new Error('frames differ in size or format');
  }
  let changed = 0;
  let total = 0;
  for (let i = 0; i < a.pixels.length; i += a.channels) {
    const d = Math.max(
      Math.abs(a.pixels[i] - b.pixels[i]),
      Math.abs(a.pixels[i + 1] - b.pixels[i + 1]),
      Math.abs(a.pixels[i + 2] - b.pixels[i + 2]));
    if (d > threshold) changed++;
    total++;
  }
  return changed / total;
}

module.exports = { decodePng, summarize, meanDifference, changedFraction };
