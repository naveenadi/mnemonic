import type { SearchResult, ScoreExplain } from '../types.js';

const RRF_K = 60;

interface RankedResult {
  result: SearchResult;
  contributions: Array<{
    source: 'fts' | 'vector' | 'hyde';
    queryType: 'original' | 'expanded' | 'hyde';
    query: string;
    rank: number;
    weight: number;
    backendScore: number;
    rrfContribution: number;
  }>;
  totalRRF: number;
  bestRank: number;
}

/** Apply Reciprocal Rank Fusion to merge ranked result sets */
export function fuseResults(
  lists: Array<{
    results: SearchResult[];
    source: 'fts' | 'vector' | 'hyde';
    queryType: 'original' | 'expanded' | 'hyde';
    query: string;
    weight: number;
  }>,
  options?: {
    topRankBonus?: boolean;
    candidateLimit?: number;
  }
): { results: SearchResult[]; ranked: Map<string, RankedResult> } {
  const rankMap = new Map<string, RankedResult>();
  const candidateLimit = options?.candidateLimit ?? 30;

  // Collect all results into rank map
  for (const list of lists) {
    const w = list.weight;
    for (let i = 0; i < list.results.length; i++) {
      const r = list.results[i];
      const rank = i + 1;
      const rrfScore = 1 / (RRF_K + rank);

      if (!rankMap.has(r.docid)) {
        rankMap.set(r.docid, {
          result: r,
          contributions: [],
          totalRRF: 0,
          bestRank: rank,
        });
      }

      const entry = rankMap.get(r.docid)!;
      const contribution = {
        source: list.source,
        queryType: list.queryType,
        query: list.query,
        rank,
        weight: w,
        backendScore: r.score,
        rrfContribution: rrfScore * w,
      };

      entry.contributions.push(contribution);
      entry.totalRRF += rrfScore * w;
      entry.bestRank = Math.min(entry.bestRank, rank);
    }
  }

  // Apply top-rank bonus: docs ranked #1 in any list get +0.05, #2-3 get +0.02
  if (options?.topRankBonus !== false) {
    for (const [, entry] of rankMap) {
      for (const c of entry.contributions) {
        if (c.rank === 1 && c.weight >= 1) {
          entry.totalRRF += 0.05;
        } else if (c.rank <= 3) {
          entry.totalRRF += 0.02;
        }
      }
    }
  }

  // Sort by RRF score descending
  const sorted = [...rankMap.entries()]
    .sort((a, b) => b[1].totalRRF - a[1].totalRRF)
    .slice(0, candidateLimit);

  // Build results with scores
  const results: SearchResult[] = [];
  const ranked = new Map<string, RankedResult>();

  for (const [docid, entry] of sorted) {
    entry.result.score = entry.totalRRF;
    results.push(entry.result);
    ranked.set(docid, entry);
  }

  return { results, ranked };
}

/** Apply position-aware blending between RRF and reranker scores */
export function blendWithRerank(
  rrfRanked: Map<string, RankedResult>,
  rerankScores: Map<string, number>,
  limit?: number
): SearchResult[] {
  const blended: Array<{ result: SearchResult; score: number }> = [];

  // Sort RRF entries by rank to determine position
  const sortedRrf = [...rrfRanked.entries()].sort(
    (a, b) => b[1].totalRRF - a[1].totalRRF
  );

  for (let i = 0; i < sortedRrf.length; i++) {
    const [docid, entry] = sortedRrf[i];
    const rank = i + 1;
    const rerankScore = rerankScores.get(docid);

    let rrfWeight: number;
    let rerankWeight: number;

    if (rank <= 3) {
      rrfWeight = 0.75;
      rerankWeight = 0.25;
    } else if (rank <= 10) {
      rrfWeight = 0.6;
      rerankWeight = 0.4;
    } else {
      rrfWeight = 0.4;
      rerankWeight = 0.6;
    }

    const finalScore =
      rrfWeight * entry.totalRRF +
      (rerankScore !== undefined ? rerankWeight * rerankScore : 0);

    const result = { ...entry.result };
    result.score = Math.min(1, Math.max(0, finalScore));

    blended.push({ result, score: finalScore });
  }

  // Sort by blended score
  blended.sort((a, b) => b.score - a.score);

  const limitNum = limit ?? 10;
  return blended.slice(0, limitNum).map((b) => b.result);
}
