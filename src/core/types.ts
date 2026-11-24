// Shared data model for the clause index of a standard document (SR-010..SR-019).

/** A text run extracted from a PDF page, in top-left page coordinates (points, scale 1). */
export interface RawItem {
  str: string;
  x: number; // left
  y: number; // baseline, measured from page top
  w: number; // advance width
  size: number; // font size (points)
  font: string;
}

export interface RawPage {
  page: number; // 1-based
  width: number;
  height: number;
  items: RawItem[];
}

/** A character-addressable segment inside a line (for sub-line boxes). */
export interface Seg { t0: number; t1: number; x0: number; x1: number }

export interface Line {
  page: number;
  text: string;
  x0: number; y0: number; x1: number; y1: number;
  size: number;
  maxSize: number;
  font: string;
  segs: Seg[];
  maxGap: number; // largest horizontal gap between runs, in points
}

export interface Rect { page: number; x0: number; y0: number; x1: number; y1: number }

export type ItemKind = 'section' | 'clause' | 'definition' | 'annex' | 'table' | 'figure' | 'requirement';

export interface IndexItem {
  id: string;
  part: string;
  kind: ItemKind;
  num: string; // "5.1.2", "3.10", "A", "B.4.2", "Table A.1", "5.1.2/R1"
  title: string;
  level: number;
  parent: string | null;
  page: number; // first PDF page (1-based)
  pageLabel: string; // printed page number, if found
  text: string;
  regions: Rect[]; // own region (until next heading of any level)
  full?: Rect[]; // region including sub-clauses, only when different from own
}

export interface Part { id: string; label: string; pageStart: number; pageEnd: number }

export interface ClauseIndex {
  format: 'clause-index';
  version: 2;
  generator: { app: string; version: string; analyzer: number };
  source: { fileName: string; sha256: string; pages: number; designation: string; title: string };
  createdAt: string;
  crop: { x0: number; y0: number; x1: number; y1: number };
  pageSizes: [number, number][];
  pageLabels: string[];
  parts: Part[];
  defaultPart: string;
  items: IndexItem[];
}
