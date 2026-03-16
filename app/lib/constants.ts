export const REGEN_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const MAX_PACKS = 2;
export const MIN_REPO_CONTRIBUTORS = 5;

/**
 * Calculate pack regeneration from last_regen_at timestamp.
 * Returns updated readyPacks and lastRegenAt if regen occurred.
 */
export function calculateRegen(
  readyPacks: number,
  lastRegenAt: number
): { readyPacks: number; lastRegenAt: number; updated: boolean } {
  if (readyPacks >= MAX_PACKS) {
    return { readyPacks, lastRegenAt, updated: false };
  }

  let updated = false;
  while (readyPacks < MAX_PACKS) {
    const elapsed = Date.now() - lastRegenAt;
    if (elapsed >= REGEN_INTERVAL_MS) {
      readyPacks++;
      lastRegenAt = lastRegenAt + REGEN_INTERVAL_MS;
      updated = true;
    } else {
      break;
    }
  }

  return { readyPacks, lastRegenAt, updated };
}
