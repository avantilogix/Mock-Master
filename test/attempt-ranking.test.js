import assert from 'node:assert/strict';
import test from 'node:test';
import { rankFirstAttempts } from '../firebase-functions/attempt-ranking.js';

test('rankings use the earliest attempt, including zero scores and ties', () => {
  const attempts = [
    {id: 'later', uid: 'a', score: 9, elapsedSeconds: 10, createdAt: '2026-01-02'},
    {id: 'first', uid: 'a', score: 0, elapsedSeconds: 50, createdAt: '2026-01-01'},
    {id: 'b', uid: 'b', score: 3, elapsedSeconds: 30, createdAt: '2026-01-01'},
    {id: 'c', uid: 'c', score: 3, elapsedSeconds: 30, createdAt: '2026-01-01'},
    {id: 'same-time-later', uid: 'd', score: 8, elapsedSeconds: 5, createdAt: '2026-01-01', sequence: 2},
    {id: 'same-time-first', uid: 'd', score: 1, elapsedSeconds: 5, createdAt: '2026-01-01', sequence: 1},
  ];
  assert.deepEqual(rankFirstAttempts(attempts).map(({uid, score, rank}) => [uid, score, rank]),
    [['b', 3, 1], ['c', 3, 1], ['d', 1, 3], ['a', 0, 4]]);
});
