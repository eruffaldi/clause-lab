// SR-051: index file validation and migration between schema versions.
import { ANALYZER_VERSION, INDEX_FORMAT, INDEX_SCHEMA } from '../version';
import type { ClauseIndex } from './types';

/** Accept current and earlier index files (any "*clause-index" format, schema 1..current); upgrade to current. */
export function normalizeIndex(raw: unknown): ClauseIndex {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.format !== 'string' || !/(^|-)clause-index$/.test(o.format)) throw new Error('not a Clause Lab index');
  const v = Number(o.version);
  if (!Number.isInteger(v) || v < 1) throw new Error('missing schema version');
  if (v > INDEX_SCHEMA) throw new Error(`index schema v${v} is newer than this app (v${INDEX_SCHEMA}) — update Clause Lab`);
  if (!Array.isArray(o.items) || !Array.isArray(o.parts) || !o.source) throw new Error('incomplete index');
  const idx = { ...o } as unknown as ClauseIndex & { generator?: ClauseIndex['generator'] };
  if (v === 1) idx.generator = { app: 'clause-lab', version: 'unknown', analyzer: 1 };
  (idx as { format: string }).format = INDEX_FORMAT;
  (idx as { version: number }).version = INDEX_SCHEMA;
  return idx as ClauseIndex;
}

/** SR-052: a cached index is reused only if it was produced by the current analyzer revision. */
export const isCurrentAnalysis = (idx: ClauseIndex): boolean => idx.generator?.analyzer === ANALYZER_VERSION;
