import type { ChunkRecord } from '../types.js';
import { createHash } from 'node:crypto';

// ─── Break Point Scoring ───────────────────────────────────────────

interface BreakPoint {
  pos: number;
  score: number;
  line: number;
}

const HEADING_SCORES: Record<string, number> = {
  '# ': 100, // H1
  '## ': 90, // H2
  '### ': 80, // H3
  '#### ': 70, // H4
  '##### ': 60, // H5
  '###### ': 50, // H6
};

const CODE_BLOCK_SCORE = 80;
const HR_SCORE = 60;
const BLANK_LINE_SCORE = 20;
const LIST_ITEM_SCORE = 5;
const LINE_BREAK_SCORE = 1;

/** Detect all break points in markdown content with scores */
function findBreakPoints(content: string): BreakPoint[] {
  const points: BreakPoint[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let linePos = 0;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Toggle code block state
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      linePos += line.length + 1;
      continue;
    }

    // Skip content inside code blocks
    if (inCodeBlock) {
      linePos += line.length + 1;
      continue;
    }

    // Check heading patterns
    for (const [prefix, score] of Object.entries(HEADING_SCORES)) {
      if (line.startsWith(prefix)) {
        points.push({ pos: linePos, score, line: lineNum });
        break;
      }
    }

    // Horizontal rules
    if (/^(---|\*\*\*)\s*$/.test(line) && line.length >= 3) {
      points.push({ pos: linePos, score: HR_SCORE, line: lineNum });
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      points.push({ pos: linePos, score: BLANK_LINE_SCORE, line: lineNum });
    }

    // List items
    if (/^(\s*[-*]\s|\s*\d+[.)]\s)/.test(line)) {
      points.push({ pos: linePos, score: LIST_ITEM_SCORE, line: lineNum });
    }

    // Line break (every line gets a minimal score)
    if (line.length > 0) {
      points.push({ pos: linePos, score: LINE_BREAK_SCORE, line: lineNum });
    }

    linePos += line.length + 1;
  }

  return points;
}

/** Find the best break point near a target position */
function findBestBreak(
  breakPoints: BreakPoint[],
  targetPos: number,
  windowSize: number
): number | null {
  const windowStart = Math.max(0, targetPos - windowSize);
  const windowEnd = Math.min(targetPos, targetPos + 100);

  const candidates = breakPoints.filter(
    (bp) => bp.pos >= windowStart && bp.pos <= windowEnd && bp.pos > 0
  );

  if (candidates.length === 0) return null;

  // Score: base score decays with distance from target using squared decay
  let best: BreakPoint | null = null;
  let bestScore = -1;

  for (const bp of candidates) {
    const distance = Math.abs(bp.pos - targetPos);
    const distanceFactor = 1 - (distance / windowSize) ** 2 * 0.7;
    const finalScore = bp.score * distanceFactor;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      best = bp;
    }
  }

  return best ? best.pos : null;
}

/** Get the nearest heading context for a position */
function getHeadingForPosition(content: string, pos: number): string {
  const before = content.slice(0, pos);
  const headings = before.matchAll(/^(#{1,6})\s+(.+)$/gm);
  let lastHeading = '';

  for (const match of headings) {
    lastHeading = match[2].trim();
  }

  return lastHeading;
}

const CHUNK_TARGET_TOKENS = 900;
const CHUNK_OVERLAP = 0.15; // 15% overlap
const OVERLAP_TOKENS = Math.round(CHUNK_TARGET_TOKENS * CHUNK_OVERLAP);
const WINDOW_SIZE = 200; // tokens to search for break point

/** Rough token count estimate (4 chars per token) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Chunk markdown content into ~900-token pieces with smart boundaries */
export function chunkMarkdown(
  content: string,
  docid: string,
  options?: { chunkStrategy?: 'regex' | 'auto' }
): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  const breakPoints = findBreakPoints(content);
  const totalTokens = estimateTokens(content);
  const targetChars = CHUNK_TARGET_TOKENS * 4;
  const overlapChars = OVERLAP_TOKENS * 4;

  if (totalTokens <= CHUNK_TARGET_TOKENS * 1.1) {
    // Small document — single chunk
    const heading = getHeadingForPosition(content, 0) || '';
    chunks.push({
      hash: docid,
      seq: 0,
      pos: 0,
      content,
      heading,
    });
    return chunks;
  }

  let startPos = 0;
  let seq = 0;

  while (startPos < content.length) {
    const chunkEnd = Math.min(startPos + targetChars, content.length);

    if (chunkEnd >= content.length) {
      // Final chunk
      const heading = getHeadingForPosition(content, startPos);
      chunks.push({
        hash: docid,
        seq,
        pos: startPos,
        content: content.slice(startPos),
        heading,
      });
      break;
    }

    // Find best break point near the target
    const breakPos = findBestBreak(breakPoints, chunkEnd, WINDOW_SIZE);

    const endPos = breakPos ?? chunkEnd;
    const heading = getHeadingForPosition(content, startPos);

    chunks.push({
      hash: docid,
      seq,
      pos: startPos,
      content: content.slice(startPos, endPos).trim(),
      heading,
    });

    startPos = endPos;
    seq++;
  }

  return chunks;
}

/** Format a chunk for embedding: "title | text" */
export function formatChunkForEmbedding(
  chunk: ChunkRecord,
  title: string
): string {
  if (chunk.heading && chunk.heading !== title) {
    return `${title} > ${chunk.heading} | ${chunk.content}`;
  }
  return `${title} | ${chunk.content}`;
}
