import sharp from 'sharp';
import { mkdir } from 'fs/promises';
import path from 'path';

const images = [
  { input: 'src/assets/IMG_1543.jpeg', id: '2', alt: 'Two friends celebrating at dinner' },
  { input: 'src/assets/IMG_2824.jpeg', id: '3', alt: 'Three friends on the dance floor' },
  { input: 'src/assets/IMG_2911.jpeg', id: '4', alt: 'Friends dancing at the party' },
  { input: 'src/assets/IMG_3084.jpeg', id: '5', alt: 'Group carrying friend at celebration' },
  { input: 'src/assets/Crop test.jpeg', id: '6', alt: 'Crop test' },
];

const outputDir = 'public/photos';

async function splitImage(inputPath, id) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();

  const halfWidth = Math.floor(metadata.width / 2);
  const height = metadata.height;

  // Extract left half
  await sharp(inputPath)
    .extract({ left: 0, top: 0, width: halfWidth, height })
    .jpeg({ quality: 90 })
    .toFile(path.join(outputDir, `${id}-left.jpg`));

  // Extract right half
  await sharp(inputPath)
    .extract({ left: halfWidth, top: 0, width: halfWidth, height })
    .jpeg({ quality: 90 })
    .toFile(path.join(outputDir, `${id}-right.jpg`));

  console.log(`Split ${inputPath} -> ${id}-left.jpg, ${id}-right.jpg`);
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  for (const img of images) {
    await splitImage(img.input, img.id);
  }

  console.log('\nDone! Add these to photos.ts:');
  for (const img of images) {
    console.log(`  {
    id: '${img.id}',
    srcLeft: '/photos/${img.id}-left.jpg',
    srcRight: '/photos/${img.id}-right.jpg',
    alt: '${img.alt}'
  },`);
  }
}

main().catch(console.error);
