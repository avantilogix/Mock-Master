export function firstAttempts(attempts) {
  const first = new Map();
  for (const attempt of [...attempts].sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)) ||
    (a.sequence ?? 0) - (b.sequence ?? 0) || String(a.id).localeCompare(String(b.id)))) {
    if (!first.has(attempt.uid)) first.set(attempt.uid, attempt);
  }
  return first;
}

export function rankFirstAttempts(attempts) {
  const ordered = [...firstAttempts(attempts).values()].sort((a, b) =>
    b.score - a.score || a.elapsedSeconds - b.elapsedSeconds ||
    String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
  let previous;
  return ordered.map((entry, index) => {
    const rank = previous && entry.score === previous.score && entry.elapsedSeconds === previous.elapsedSeconds ?
      previous.rank : index + 1;
    previous = {...entry, rank};
    return previous;
  });
}
