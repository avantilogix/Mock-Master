import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const source = readFileSync('public/icons/icon-source.svg', 'utf8');
const standard = Buffer.from(source);
const maskable = Buffer.from(source.replace('rx="110"', ''));

await Promise.all([
  sharp(standard).resize(56, 56).png().toFile('public/assets/logo.png'),
  sharp(standard).resize(192, 192).png().toFile('public/icons/icon-192.png'),
  sharp(standard).resize(512, 512).png().toFile('public/icons/icon-512.png'),
  sharp(maskable).resize(512, 512).png().toFile('public/icons/icon-maskable-512.png'),
]);
