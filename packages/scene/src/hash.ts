/** Stable hashing, so the same id always lands in the same place and moves the same way. */

/** FNV-1a, 32-bit, with a finishing mix. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Final mix, so ids that differ only in their last character still land far apart.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** A number in [0, 1) derived from an id. */
export function hashUnit(text: string): number {
  return hashString(text) / 4294967296;
}
