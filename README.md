# Clause Lab

Version **1.2.0** · index schema 2 · analyzer r4 — see [CHANGELOG.md](CHANGELOG.md).

Single-file HTML app to analyse PDFs of standard documents you own.

- **Import mode** extracts text with pdf.js and builds a JSON index (`clause-index`, schema 2) of clauses, terms and definitions, annexes, tables, figures and "shall" statements, each with page-coordinate regions.
- **Viewer**: one continuous scroll with margins, headers, footers and licence stamps trimmed. The selected item is framed in red, and the frame continues (dashed edge) across page breaks. Its "shall" statements appear as dashed sub-boxes. Click on the page to select whatever is under the cursor.
- **Scroll settings**: choose full smooth motion, an immediate jump, or a brief directional scroll followed by a jump when selecting an index entry. The preference is saved in the browser.
- **Basket**: collect items, add a note and a gap status (covered / partial / gap / n/a), and include sub-clauses when you want them.
- **Export**: one self-contained HTML report with a status summary table, citations, text and page-crop images. Print it to PDF from the report itself. Single items can be copied as text or saved as a PNG.
- Consolidated PDFs that contain several editions (Redline + Final) are split into parts, and Final is selected by default. Sequential bilingual standards keep the English edition and ignore a duplicated French section.
- Indices are cached in IndexedDB by the file's SHA-256, and the basket is stored per document. The PDF never leaves the browser.

Encoding: **Base64 inline (Option A, speed)**. The pdf.js worker is kept in a non-executable `<script type="application/octet-stream">` tag and turned into a Blob URL when the browser is idle.

## Usage

```
make test      # typecheck + unit tests in Docker
make build     # tests, then dist/clause-lab.html
make dev       # serve on http://localhost:3000
make analyze PDF=~/standards/std12345.pdf   # offline index -> std12345.clause-index.json
make version   # print the current version
make bump PART=patch|minor|major   # bump package.json version
make example   # regenerate examples/example-standard.pdf and its index
```

Open `dist/clause-lab.html`, then press **Open PDF** or drop a PDF onto the page. Search accepts numbers (`5.1.1`, `A.2`, `table a.1`) or words; the “shall” chip shows the requirement statements. Keyboard shortcuts: `j` / `k` move to the next / previous item.

The index JSON can be edited by hand (fix a title, adjust a rectangle) and loaded again with **Load index**.

## Example

`examples/example-standard.pdf` is a synthetic 9-page document ("STD 12345:2024 Example widgets — Life cycle processes") with invented text that you are free to redistribute. It is laid out like a standard: cover, contents, foreword, clauses with sub-clauses, terms and definitions, "shall" lists with class markers, notes, a table, a figure, an annex and a bibliography. Clause 5.2 continues onto a second page. `examples/example-standard.clause-index.json` is its index. Open the PDF in the app to try it (`make dev` also serves both files under `/examples/`). `make example` rebuilds both files, and a unit test fails if the committed index no longer matches the analyzer.

No other documents belong in the repository: `.gitignore` excludes every other `*.pdf` and `*.clause-index.json`, and a test checks this.

## Index format (excerpt)

```json
{ "format": "clause-index", "version": 2,
  "generator": { "app": "clause-lab", "version": "1.2.0", "analyzer": 3 },
  "source": { "fileName": "…pdf", "sha256": "…", "pages": 176, "designation": "STD 12345:2006+AMD1:2015" },
  "crop": { "x0": 56.9, "y0": 79.4, "x1": 558.7, "y1": 801.7 },
  "parts": [ { "id": "final", "label": "Final", "pageStart": 95, "pageEnd": 176 } ],
  "items": [ { "id": "final:5.1.1", "kind": "clause", "num": "5.1.1", "title": "Development plan",
               "level": 3, "parent": "final:5.1", "page": 112, "pageLabel": "18", "text": "…",
               "regions": [ { "page": 112, "x0": 67.9, "y0": 700.1, "x1": 527.3, "y1": 760.2 } ] } ] }
```

Coordinates are PDF points at scale 1 with the origin at the top left. `regions` covers the item up to the next heading; `full`, when present, also covers its sub-clauses.

## Versioning

- **App version** (semver) lives only in `package.json`. The build injects it into the page (header badge, `<meta name="generator">`), into every index (`generator.version`) and into every report footer. Each build writes `dist/clause-lab.html` and a copy named `dist/clause-lab-v<version>.html`.
- **Index schema** (`version` field, currently 2) changes only when the JSON structure changes. Older files (schema 1, any `*clause-index` format name) are upgraded on load. Files with a newer schema are refused.
- **Analyzer revision** (`ANALYZER_VERSION` in `src/version.ts`, currently 4) is bumped whenever detection or region output changes. A cached index from another revision is rebuilt automatically when its PDF is opened.

## Attributions and licensing

- **pdf.js** (`pdfjs-dist` 4.10.38), © Mozilla Foundation and contributors, Apache License 2.0 — https://github.com/mozilla/pdf.js. The library and its worker are embedded in the built HTML.

  > Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

- Build and test tools (not shipped): TypeScript (Apache-2.0), esbuild (MIT), Vitest (MIT), pdf-lib (MIT, used only to generate the example).
- The example PDF uses the standard PDF base-14 Helvetica fonts (not embedded) and contains only original text.
- No standard text is bundled. Indices and reports you generate contain excerpts from your licensed copies and are for your own use, within the terms of your licence.
