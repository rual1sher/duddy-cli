/** @fileoverview Нечёткая замена фрагментов текста в файлах */

/**
 * Counts non-overlapping occurrences of needle in haystack
 */
export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Multi-tier resilient string replacement for AI tool calling.
 * Handles exact matches, CRLF/LF normalization, trimmed edge differences,
 * and line-by-line whitespace/indentation tolerant matches.
 */
export function fuzzyReplace(original, oldContent, newContent) {
  if (!oldContent || typeof oldContent !== 'string') {
    return { success: false, reason: 'empty_old_content' };
  }

  // Tier 1: Exact match
  if (original.includes(oldContent)) {
    const count = countOccurrences(original, oldContent);
    if (count > 1) {
      return { success: false, reason: 'ambiguous', count };
    }
    return { success: true, content: original.replace(oldContent, () => newContent), method: 'exact' };
  }

  const isCrlf = original.includes('\r\n');
  const normOriginal = original.replace(/\r\n/g, '\n');
  const normOld = oldContent.replace(/\r\n/g, '\n');
  const normNew = newContent.replace(/\r\n/g, '\n');

  // Tier 2: CRLF-normalized match
  if (normOriginal.includes(normOld)) {
    const count = countOccurrences(normOriginal, normOld);
    if (count > 1) {
      return { success: false, reason: 'ambiguous', count };
    }
    const res = normOriginal.replace(normOld, () => normNew);
    return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: 'crlf-normalized' };
  }

  // Tier 3: Whole-file match (trimmed)
  if (normOriginal.trim() === normOld.trim()) {
    return { success: true, content: isCrlf ? normNew.replace(/\n/g, '\r\n') : normNew, method: 'whole-file' };
  }

  // Tier 4: Trimmed edges match (leading/trailing newlines/spaces)
  const trimmedOld = normOld.trim();
  if (trimmedOld && normOriginal.includes(trimmedOld)) {
    const count = countOccurrences(normOriginal, trimmedOld);
    if (count > 1) {
      return { success: false, reason: 'ambiguous', count };
    }
    const res = normOriginal.replace(trimmedOld, () => normNew.trim());
    return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: 'trimmed-edges' };
  }

  // Tier 5: Line-by-line whitespace-tolerant match (trimEnd & trim)
  const origLines = normOriginal.split('\n');
  const oldLines = normOld.split('\n');

  let startOld = 0;
  while (startOld < oldLines.length && !oldLines[startOld].trim()) startOld++;
  let endOld = oldLines.length - 1;
  while (endOld >= startOld && !oldLines[endOld].trim()) endOld--;

  if (startOld <= endOld) {
    const searchLines = oldLines.slice(startOld, endOld + 1);
    const searchLen = searchLines.length;

    for (const mode of ['trimEnd', 'trim']) {
      const matches = [];
      for (let i = 0; i <= origLines.length - searchLen; i++) {
        let match = true;
        for (let j = 0; j < searchLen; j++) {
          const l1 = origLines[i + j][mode]();
          const l2 = searchLines[j][mode]();
          if (l1 !== l2) {
            match = false;
            break;
          }
        }
        if (match) {
          matches.push(i);
        }
      }

      if (matches.length > 1) {
        return { success: false, reason: 'ambiguous', count: matches.length };
      }

      if (matches.length === 1) {
        const matchIdx = matches[0];
        const newLines = normNew.split('\n');
        const replacedLines = [
          ...origLines.slice(0, matchIdx),
          ...newLines,
          ...origLines.slice(matchIdx + searchLen)
        ];
        const res = replacedLines.join('\n');
        return { success: true, content: isCrlf ? res.replace(/\n/g, '\r\n') : res, method: `fuzzy-lines-${mode}` };
      }
    }
  }

  return { success: false, reason: 'not_found' };
}
