function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
    .trim();
}

function words(value) {
  return normalize(value).split(/[\s@._+-]+/).filter(Boolean);
}

// Damerau-Levenshtein with adjacent transpositions. Directory queries are short,
// so the straightforward matrix keeps this predictable without a dependency.
function editDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, (_, row) => {
    const values = Array(right.length + 1).fill(0);
    values[0] = row;
    return values;
  });
  for (let column = 0; column <= right.length; column += 1) matrix[0][column] = column;

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitution,
      );
      if (
        row > 1 && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
}

function typoAllowance(value) {
  if (value.length < 3) return 0;
  if (value.length < 7) return 1;
  return 2;
}

function fieldScore(query, value) {
  const candidate = normalize(value);
  if (!candidate) return Infinity;
  if (candidate === query) return 0;
  if (candidate.startsWith(query)) return 10 + (candidate.length - query.length) / 100;

  const candidateWords = words(candidate);
  if (candidateWords.some((word) => word.startsWith(query))) return 20;
  if (candidate.includes(query)) return 30 + candidate.indexOf(query) / 100;

  const queryWords = words(query);
  if (!queryWords.length) return Infinity;
  let typoCost = 0;
  for (const queryWord of queryWords) {
    let best = Infinity;
    for (const candidateWord of candidateWords) {
      if (candidateWord.startsWith(queryWord)) {
        best = 0;
        break;
      }
      const distance = editDistance(queryWord, candidateWord);
      if (distance <= typoAllowance(queryWord)) best = Math.min(best, distance);
    }
    if (!Number.isFinite(best)) return Infinity;
    typoCost += best;
  }
  return 40 + typoCost * 5;
}

function searchScore(query, entry) {
  const rawQuery = normalize(query);
  const usernameQuery = rawQuery.startsWith("@") ? rawQuery.slice(1) : rawQuery;
  const usernameScore = fieldScore(usernameQuery, entry.username);
  const nameScore = fieldScore(rawQuery, entry.name);
  const emailScore = fieldScore(rawQuery, entry.email);
  return Math.min(usernameScore, nameScore + 1, emailScore + 2);
}

export function rankDirectoryEntries(entries, query, limit = 12) {
  return entries
    .map((entry) => ({ entry, score: searchScore(query, entry) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score
      || normalize(left.entry.name || left.entry.username || left.entry.email)
        .localeCompare(normalize(right.entry.name || right.entry.username || right.entry.email)))
    .slice(0, limit)
    .map(({ entry }) => entry);
}
