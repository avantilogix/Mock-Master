import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { encodeCover, expiryInput, requireActive } from '../firebase-functions/publishing-media.js';

test('course expiry includes the entire selected calendar day in India', () => {
  const course = { expiresOn: '2028-02-29' };
  const midnight = Date.parse('2028-02-29T18:30:00Z');
  assert.equal(expiryInput(course.expiresOn, { future: true, now: midnight - 1 }), course.expiresOn);
  assert.equal(requireActive(course, midnight - 1), midnight);
  assert.throws(() => requireActive(course, midnight), { status: 410 });
  assert.throws(() => expiryInput(course.expiresOn, { future: true, now: midnight }), { status: 422 });
  assert.throws(() => expiryInput('2027-02-29'), { status: 422 });
  assert.equal(requireActive({}, midnight), null);
});

test('cover uploads reject unsupported image formats and resize large covers', async () => {
  const input = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#3254a0' } }).png().toBuffer();
  const metadata = await sharp(await encodeCover(input)).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', 1400, 700]);

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');
  await assert.rejects(() => encodeCover(svg), { status: 422 });
});
