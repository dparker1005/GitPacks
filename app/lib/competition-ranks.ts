const STAT_FIELDS = {
  commits: 'commits',
  streak: 'maxStreak',
  activeWeeks: 'activeWeeks',
  peak: 'peak',
  recent: 'recent',
  consistency: 'consistency',
  prsMerged: 'prsMerged',
  issues: 'issues',
} as const;

export type RankPctScores = Record<keyof typeof STAT_FIELDS, number>;

/**
 * Add display-only percentile scores based on competition ranking.
 *
 * Contributors tied on a stat receive the same best rank. The normalized score
 * retains the existing UI scale: rank 1 = 1, rank n = 0.
 */
export function withCompetitionRankScores<T extends Record<string, unknown>>(
  entries: T[]
): Array<T & { rankPctScores: RankPctScores }> {
  const n = entries.length;

  return entries.map((entry) => {
    const rankPctScores = {} as RankPctScores;

    for (const [scoreKey, field] of Object.entries(STAT_FIELDS) as Array<
      [keyof typeof STAT_FIELDS, (typeof STAT_FIELDS)[keyof typeof STAT_FIELDS]]
    >) {
      const value = Number(entry[field]) || 0;
      let above = 0;
      for (const candidate of entries) {
        if ((Number(candidate[field]) || 0) > value) above++;
      }

      rankPctScores[scoreKey] =
        n > 1 ? (n - above - 1) / (n - 1) : value > 0 ? 1 : 0;
    }

    return { ...entry, rankPctScores };
  });
}
