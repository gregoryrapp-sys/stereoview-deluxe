#!/usr/bin/env node
/**
 * Generate animated GIFs from stereo image pairs
 * Creates a "wiggle" effect by switching between left and right images
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import GIFEncoder from 'gif-encoder-2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const photosDir = path.join(__dirname, '..', 'public', 'photos');

// GIF settings
const FRAME_DELAY = 150; // milliseconds between frames (roughly 6-7 fps)
const LOOP_COUNT = 0; // 0 = infinite loop

async function getImageBuffer(imagePath) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();

  // Get raw RGBA buffer
  const { data, info } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, width: info.width, height: info.height };
}

async function generateGif(leftPath, rightPath, outputPath) {
  console.log(`Generating GIF: ${path.basename(outputPath)}`);

  // Load both images
  const [left, right] = await Promise.all([
    getImageBuffer(leftPath),
    getImageBuffer(rightPath)
  ]);

  // Verify dimensions match
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(`Image dimensions don't match: ${leftPath} vs ${rightPath}`);
  }

  const { width, height } = left;

  // Create GIF encoder
  const encoder = new GIFEncoder(width, height, 'neuquant', true);
  encoder.setDelay(FRAME_DELAY);
  encoder.setRepeat(LOOP_COUNT);
  encoder.setQuality(10); // Lower = better quality, higher = faster

  // Create output stream
  const outputStream = fs.createWriteStream(outputPath);
  encoder.createReadStream().pipe(outputStream);

  encoder.start();

  // Add frames (left, right, left, right pattern for smooth wiggle)
  encoder.addFrame(left.data);
  encoder.addFrame(right.data);

  encoder.finish();

  // Wait for file to be written
  await new Promise((resolve, reject) => {
    outputStream.on('finish', resolve);
    outputStream.on('error', reject);
  });

  const stats = fs.statSync(outputPath);
  console.log(`  Created: ${outputPath} (${(stats.size / 1024).toFixed(1)} KB)`);
}

async function findStereoImagePairs() {
  const files = fs.readdirSync(photosDir);
  const pairs = new Map();

  for (const file of files) {
    // Match patterns like "1-left.jpg", "1-right.jpg"
    const match = file.match(/^(\d+)-(left|right)\.(jpg|jpeg|png)$/i);
    if (match) {
      const id = match[1];
      const side = match[2].toLowerCase();
      const ext = match[3];

      if (!pairs.has(id)) {
        pairs.set(id, { id, ext });
      }
      pairs.get(id)[side] = path.join(photosDir, file);
    }
  }

  // Filter to only complete pairs
  const completePairs = [];
  for (const [id, pair] of pairs) {
    if (pair.left && pair.right) {
      completePairs.push(pair);
    } else {
      console.warn(`Warning: Incomplete pair for id ${id}`);
    }
  }

  return completePairs.sort((a, b) => parseInt(a.id) - parseInt(b.id));
}

async function main() {
  console.log('Stereo to GIF Generator');
  console.log('=======================\n');

  const pairs = await findStereoImagePairs();

  if (pairs.length === 0) {
    console.log('No stereo image pairs found in', photosDir);
    return;
  }

  console.log(`Found ${pairs.length} stereo pair(s)\n`);

  for (const pair of pairs) {
    const outputPath = path.join(photosDir, `${pair.id}-wiggle.gif`);
    await generateGif(pair.left, pair.right, outputPath);
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
