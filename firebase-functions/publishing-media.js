import { createHash } from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import { fail } from './documents.js';

const imageId = /^[a-f0-9]{64}$/;
const pathFor = id => `publishing-images/${id}.webp`;

export function courseCutoff(date) {
  if (typeof date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(date)) return null;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return null;
  return midnight + 18.5 * 60 * 60 * 1000;
}

export function visibleCourses(items, now = Date.now()) {
  return items.filter(item => !item.publicLearning && !item.archived &&
    (courseCutoff(item.expiresOn) ?? Infinity) > now);
}

export function expiryInput(date, { future = false, now = Date.now() } = {}) {
  const cutoff = courseCutoff(date);
  if (cutoff === null) fail(422, 'Enter a valid course expiry date.');
  if (future && cutoff <= now) fail(422, 'Choose today or a future date in India.');
  return date;
}

export function requireActive(item, now = Date.now()) {
  const cutoff = courseCutoff(item.expiresOn);
  if (cutoff !== null && now >= cutoff) fail(410, 'This course has expired. Purchases and study access are closed.');
  return cutoff;
}

export async function encodeCover(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) fail(422, 'Choose a JPEG, PNG, or WebP image.');
  try {
    const image = sharp(buffer, { limitInputPixels: 24_000_000, failOn: 'error' });
    const info = await image.metadata();
    if (['jpeg', 'png', 'webp'].includes(info.format)) {
      return await image.rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer();
    }
  } catch {
    fail(422, 'This image could not be read or is larger than 24 megapixels.');
  }
  fail(422, 'Choose a JPEG, PNG, or WebP image.');
}

export function publishingMedia(api, { bucket, processDocument }) {
  api.get('/publishing-images/:id', async (req, res) => {
    if (!imageId.test(req.params.id)) fail(404, 'Image not found.');
    const [image] = await bucket.file(pathFor(req.params.id)).download().catch(error => {
      if (error.code === 404) fail(404, 'Image not found.');
      throw error;
    });
    res.set('Cache-Control', 'public, max-age=31536000, immutable').type('image/webp').send(image);
  });
  return {
    adminRoutes() {
      api.post('/admin/publishing-images', express.raw({ type: 'application/octet-stream', limit: '6mb', inflate: false }),
        async (req, res) => {
          const bytes = await processDocument(() => encodeCover(req.body));
          // Covers are public marketing assets, shared safely when identical content is uploaded.
          const id = createHash('sha256').update(bytes).digest('hex');
          await bucket.file(pathFor(id)).save(bytes, { resumable: false, contentType: 'image/webp' });
          res.status(201).json({ id });
        });
    },
    async validate(ids) {
      if (ids === undefined || ids === null) return [];
      if (!Array.isArray(ids) || ids.length > 8 ||
          ids.some(id => typeof id !== 'string' || !imageId.test(id)) || new Set(ids).size !== ids.length) {
        fail(422, 'Add 1 to 8 different cover images.');
      }
      if (!ids.length) return [];
      const existing = await Promise.all(ids.map(id => bucket.file(pathFor(id)).exists()));
      if (existing.some(([exists]) => !exists)) fail(422, 'One or more cover images are missing. Upload them again.');
      return ids;
    },
  };
}
