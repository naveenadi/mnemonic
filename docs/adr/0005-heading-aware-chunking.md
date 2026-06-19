# ADR-0005: Heading-Aware Markdown Chunking

**Status**: Accepted  
**Date**: 2026-01-15

## Context

Documents need to be split into chunks for embedding, but naive token-count splitting breaks at awkward boundaries — mid-sentence, mid-paragraph, or across section headings. This reduces embedding quality (a chunk containing two unrelated sections produces a muddy vector) and destroys the hierarchical context needed for result display.

## Decision

Use a break-point scoring system over markdown structure:

1. **Scan** the document for structural break points and assign scores:
   - Headings H1-H6: 100-50 (by level)
   - Code block boundaries: 80
   - Horizontal rules: 60
   - Blank lines: 20
   - List items: 5
   - Every line break: 1

2. **Segment** at ~900-token target with 15% overlap, picking the highest-scoring break point within a 200-char window of the target boundary.

3. **Annotate** each chunk with the nearest preceding heading for context hierarchy.

Single chunks (documents under ~1000 tokens) bypass the segmentation entirely.

## Consequences

**Positive**
- Chunks align with semantic boundaries (sections, code blocks, list groups)
- Heading context propagates to search results and embeddings (chunks embed as `"title > heading | content"`)
- No dependency on external chunkers (langchain, etc.)
- Deterministic — same document always produces same chunks

**Negative**
- Break-point scores are heuristic (not learned from data)
- 15% overlap means re-embedding more chunks than strict boundaries would
- No special handling for tables, callouts, or admonitions
- 900-token target is fixed — no per-collection or per-model tuning
