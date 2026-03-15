export interface Contributor {
  login: string;
  rarity: string;
  commits: number;
  prsMerged: number;
  issues: number;
  activeWeeks: number;
  maxStreak: number;
  peak: number;
  [key: string]: any;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  mythic: 1,
  legendary: 5,
  epic: 12,
  rare: 22,
  common: 60,
};

export function selectPackCards(
  allContributors: Contributor[],
  count: number
): Contributor[] {
  const w = DEFAULT_WEIGHTS;
  const byRarity: Record<string, Contributor[]> = {
    mythic: [],
    legendary: [],
    epic: [],
    rare: [],
    common: [],
  };
  allContributors.forEach((c) => byRarity[c.rarity].push(c));

  function rollRarity(): string {
    const available: Record<string, number> = {};
    let totalW = 0;
    for (const r of ['mythic', 'legendary', 'epic', 'rare', 'common']) {
      if (byRarity[r].length > 0) {
        available[r] = w[r];
        totalW += w[r];
      }
    }
    let roll = Math.random() * totalW;
    for (const [r, rw] of Object.entries(available)) {
      roll -= rw;
      if (roll <= 0) return r;
    }
    return 'common';
  }

  const picks: Contributor[] = [];

  // Pick first (count-1) cards with weighted random
  while (picks.length < count - 1) {
    const rarity = rollRarity();
    const pool = byRarity[rarity];
    const c = pool[Math.floor(Math.random() * pool.length)];
    if (picks.includes(c) && picks.length < allContributors.length) continue;
    picks.push(c);
  }

  // Card 5: guaranteed rare or better
  const rareOrBetter = [
    ...byRarity.rare,
    ...byRarity.epic,
    ...byRarity.legendary,
    ...byRarity.mythic,
  ];
  if (rareOrBetter.length > 0) {
    const guarWeights: Record<string, number> = {
      mythic: w.mythic,
      legendary: w.legendary,
      epic: w.epic,
      rare: w.rare,
    };
    const guarAvail: Record<string, number> = {};
    let guarTotal = 0;
    for (const r of ['mythic', 'legendary', 'epic', 'rare']) {
      if (byRarity[r].length > 0) {
        guarAvail[r] = guarWeights[r];
        guarTotal += guarWeights[r];
      }
    }
    let roll = Math.random() * guarTotal;
    let guarRarity = 'rare';
    for (const [r, rw] of Object.entries(guarAvail)) {
      roll -= rw;
      if (roll <= 0) {
        guarRarity = r;
        break;
      }
    }
    const pool = byRarity[guarRarity];
    picks.push(pool[Math.floor(Math.random() * pool.length)]);
  } else {
    // Fallback: no rare-or-better cards available, fill with random
    const rarity = rollRarity();
    const pool = byRarity[rarity];
    picks.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  // Shuffle only first (count-1) cards, leave card 5 in place
  for (let i = Math.min(picks.length - 2, 3); i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks;
}
