export const MILESTONE_DEFS: Record<string, { fixed: number[]; increment: number; breakpoint?: number; increment2?: number; statKey: string }> = {
  commits:      { fixed: [1, 10, 50, 100, 500],       increment: 0,   statKey: 'commits' },
  prs_merged:   { fixed: [1, 5, 10, 25, 50, 100],     increment: 50,  breakpoint: 500,  increment2: 100, statKey: 'prsMerged' },
  issues:       { fixed: [1, 5, 10, 25, 50],           increment: 25,  statKey: 'issues' },
  active_weeks: { fixed: [1, 4, 12, 26, 52],           increment: 26,  breakpoint: 104,  increment2: 52,  statKey: 'activeWeeks' },
  streak:       { fixed: [1, 2, 4, 8, 12],             increment: 4,   statKey: 'maxStreak' },
  peak_week:    { fixed: [1, 3, 5, 10, 20],            increment: 10,  statKey: 'peak' },
};

const REPO_SIZE_TIERS = [10, 20, 40, 60, 100];

export function getMaxMilestonesPerStat(cardCount: number): number {
  let cap = 0;
  for (const tier of REPO_SIZE_TIERS) {
    if (cardCount >= tier) cap++;
    else break;
  }
  return cap;
}

export function getEarnedThresholds(statValue: number, def: { fixed: number[]; increment: number; breakpoint?: number; increment2?: number }): number[] {
  const { fixed, increment, breakpoint, increment2 } = def;
  const thresholds: number[] = [];
  for (const t of fixed) {
    if (statValue >= t) thresholds.push(t);
  }
  if (increment > 0 && fixed.length > 0 && statValue >= fixed[fixed.length - 1]) {
    let next = fixed[fixed.length - 1] + increment;
    while (statValue >= next) {
      thresholds.push(next);
      const inc = (breakpoint && increment2 && next >= breakpoint) ? increment2 : increment;
      next += inc;
    }
  }
  return thresholds;
}

/** Number of earned, unlocked milestones not yet in claimedSet ("stat_type:threshold" keys). */
export function countClaimableMilestones(contributor: any, cardCount: number, claimedSet: Set<string>): number {
  const maxPerStat = getMaxMilestonesPerStat(cardCount);
  let count = 0;
  for (const [statType, def] of Object.entries(MILESTONE_DEFS)) {
    const earned = getEarnedThresholds(contributor?.[def.statKey] ?? 0, def).slice(0, maxPerStat);
    for (const t of earned) {
      if (!claimedSet.has(`${statType}:${t}`)) count++;
    }
  }
  return count;
}
