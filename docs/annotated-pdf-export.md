# Portable annotated PDF export

The exporter writes a **download copy** containing the original PDF pages and existing annotations, plus the saved Paper Workbench annotations. It does not modify the source file, use model APIs, depend on a system Python/font path, or rasterize the document. The server writer is pure JavaScript using `pdf-lib`; PDF.js and its cross-platform canvas package are used for the rendering tests.

## Integration contract

```js
import {
  exportAnnotatedPdf,
  AnnotationPdfExportError,
  AnnotationPdfGeometryError,
} from './annotation-pdf.mjs';

const { bytes, warnings, annotationCount } = await exportAnnotatedPdf({
  pdfBytes,       // Uint8Array/Buffer or ArrayBuffer, read from the authorized paper
  annotations,   // saved annotations belonging to this paper; deleted records ignored
  paperId,       // required at the route boundary to enforce binding
});
```

- `bytes` is a new `Uint8Array`; send as `application/pdf` with a sanitized filename such as `title-annotated.pdf`.
- `annotationCount` counts the **added PDF markup objects**, not the number of logical notebook records. A multi-page note creates one object per source segment; an ink record creates one object per stroke so different pen widths remain distinct.
- `warnings` currently contains `{code: 'annotation_page_comment', annotationId, page}` for records with no saved geometry. The PDF itself also says these are page comments without an exact source position. Do not silently claim they were exported as text highlights.
- Both exported error classes expose `status: 422`, a stable `code`, and a safe English `message`. The route should localize only known codes; do not expose arbitrary library exceptions or filesystem paths.
- The writer does not fetch URLs or open paths. Resolve the stored PDF through the existing authorized local-file boundary, and bind the annotation list before calling it. Web-only papers without a source PDF cannot use this format.

The HTTP route compares the captured source bytes with the immutable `sourcePdfRevision` recorded by all new PDF import paths, or the original `contentHash` of a legacy upload. A mutable current figure/vision revision cannot rebind old notes to a different file. An older arXiv import without a reliable original hash returns `409 pdf_source_unbound`; it is not silently signed with the current file's hash. Notes remain available through Markdown and JSON. A source mismatch returns `409 pdf_source_changed`, without changing either the annotations or the file.

For an unbound legacy import, the reader can inspect the current PDF and explicitly accept it through `GET`/`POST /api/papers/:id/annotations/pdf-source`. This stores a separate `annotationExportBinding` with method `user-accepted-current-pdf`, current hash and acceptance time. It does not invent an original hash, edit notes, verify historical positions, or affect model provenance. The export response identifies this choice with `X-Annotation-Source-Binding: user-accepted`; original-hash exports use `original`. Accepted or original bindings cannot be overwritten by the recovery endpoint, and any later byte change blocks export. Concurrent acceptance requests cannot replace the first choice. See the [API contract](API.md) for exact bodies and states.

Normalized rectangles use the annotation API's `1e-6` edge tolerance. Export clamps that tiny stored rounding excess to the visible page without rewriting the original coordinates; larger excursions and empty visible rectangles are rejected. The same rule is tested on every intrinsic right-angle rotation.

The download menu should say **PDF with saved annotations / 含已保存批注的 PDF**. The whole paper is exported even if the notebook is filtered; if filtered export is offered later it must be a separate explicit choice. Pending unsaved notebook edits and ink drafts are not silently saved or included. A short result message can report the added markup count and, if needed, how many page comments lack exact geometry. No permanent warning banner is needed for ordinary successful exports.

## Standard PDF representation

| Notebook record | PDF representation |
| --- | --- |
| Highlight | `/Highlight`, `/QuadPoints`, explicit vector `/AP`, popup `/Contents` |
| Underline | `/Underline`, `/QuadPoints`, explicit vector `/AP` along the visual bottom edge |
| Anchored note, translation or explanation | `/Highlight` with the original kind in `/Subj` and its body in `/Contents`, matching the source highlight plus note behavior without creating two duplicate notes |
| Record with no saved rectangles | `/Text` page comment with an explicit no-exact-position explanation |
| Ink | `/Ink`, `/InkList`, per-stroke border width and explicit vector `/AP` |
| Cross-page segments | Separate page-local objects carrying the same logical ID prefix and segment index/count |

`/Contents` retains the saved body, selected source quote and tags. The author/title is the generic “Paper Workbench”; no account name, API setting, runtime origin or machine path is added. AI translations/explanations are identified as such. `/NM` retains the logical annotation ID with page/segment/stroke suffixes; collisions with existing names receive a suffix without deleting or replacing the original object. Creation/modification dates are derived from saved record dates.

Unicode popup strings use `PDFHexString.fromText`, which encodes UTF-16. This supports Chinese and English notes without drawing text into page pixels or bundling a CJK font. It does **not** claim to create font-embedded visible FreeText annotations. [pdf-lib PDFHexString implementation](https://github.com/Hopding/pdf-lib/blob/master/src/core/objects/PDFHexString.ts)

## Coordinates and preservation

The app saves coordinates relative to the visible, rotated PDF.js viewport, normalized separately to width and height. The writer resolves inherited `MediaBox`, `CropBox` and `Rotate`; the visible source rectangle is the intersection of the two boxes. It applies the inverse viewport rotation for 0/90/180/270 degrees and retains nonzero or negative box origins. `UserUnit` affects physical dimensions but is not multiplied into stored default-user-space coordinates a second time. Invalid boxes, empty intersections and non-right-angle rotations fail explicitly instead of guessing a recovery page. This matches the normal source-view geometry described in PDF.js. [PDF.js page geometry](https://github.com/mozilla/pdf.js/blob/master/src/core/document.js), [viewport transform](https://github.com/mozilla/pdf.js/blob/master/src/display/page_viewport.js)

All new marks receive appearance streams. This matters for rotated underlines: PDF.js normalizes QuadPoints into raw-axis bounding-box order, so relying on a viewer to synthesize an underline can select the wrong visual edge. The writer draws the actual transformed visual bottom edge. Ink uses the same independent x/y scaling as the app's normalized SVG (`preserveAspectRatio="none"`). Its standard `/BS.W` is a geometric-mean fallback; an external editor that discards the supplied appearance and regenerates it from a single scalar pen width can change the apparent width. Pressure is retained in the notebook but is not rendered as variable width by the current app or export. [PDF.js annotation parsing and appearances](https://github.com/mozilla/pdf.js/blob/master/src/core/annotation.js)

The writer loads the original document with `updateMetadata: false`, appends new references to a fresh page-local `/Annots` array, and saves without updating field appearances. It does not call `copyPages`, rebuild page content, flatten forms, or invoke page normalization merely to append annotations. Existing annotation references, page content streams, links, page boxes/rotation and outlines remain in the copied document. A fresh array also prevents accidental additions to another page if the original producer shared an annotation array. The file is reserialized, so this is **not** byte-for-byte or incremental preservation. [pdf-lib page annotation storage](https://github.com/Hopding/pdf-lib/blob/master/src/core/structures/PDFPageLeaf.ts), [load/save implementation](https://github.com/Hopding/pdf-lib/blob/master/src/api/PDFDocument.ts)

## Unsupported inputs and limits

| Stable code | Reason |
| --- | --- |
| `pdf_source_invalid` | Source bytes are missing, unreadable, or contain no readable pages |
| `pdf_encrypted_unsupported` | pdf-lib does not support modifying encrypted files; `ignoreEncryption` is deliberately never used |
| `pdf_signed_unsupported` | Rewriting would invalidate a digital signature |
| `pdf_xfa_unsupported` | XFA form PDF is outside the supported export path |
| `pdf_annotations_invalid` | Existing `/Annots` cannot be preserved as a valid array of annotation dictionaries |
| `pdf_page_geometry_invalid`, `pdf_page_geometry_unsupported` | Invalid or unsupported page geometry |
| `annotation_paper_mismatch`, `annotation_page_invalid` | A note belongs to another paper or points to a missing/disordered page |
| `annotation_geometry_invalid`, `annotation_content_invalid`, `annotation_kind_unsupported`, `annotation_export_invalid` | Saved note data cannot be exported faithfully |
| `pdf_export_unsupported` | Other unsupported PDF structure; safe fallback without partial download |

Encrypted PDFs are rejected even if a reader can display them with an empty password. `ignoreEncryption` only bypasses a guard and does not decrypt the file. A digitally signed input is rejected rather than producing an apparently signature-preserving copy. [pdf-lib encryption limitations](https://github.com/Hopding/pdf-lib#encryption-handling)

Preserving source objects is not sanitizing the original PDF. Existing links and other original content remain original content; the exporter adds no JavaScript, launch action, external resource, or network call. Untrusted provider output never becomes PDF operators: saved notes enter only encoded string fields, and drawing operators are generated from validated numeric geometry.

## Evidence and remaining acceptance checks

`node --test tests/annotation-pdf-geometry.test.mjs tests/annotation-pdf.test.mjs` covers:

- Source input hash unchanged; original selectable text, content-stream references, original annotations/links, outline and source page count preserved.
- Chinese/English body, quote and tags round-trip through PDF.js annotation extraction; generic author and valid timestamps.
- Real PDF.js pixel rendering of highlight, underline and ink on 0/90/180/270-degree pages, with a nonzero CropBox and `UserUnit=2`.
- An ordinary page, inherited page-tree boxes/rotation, and the fact that `UserUnit` is page-local.
- Cross-page disjoint segments, geometry-free comments, per-stroke widths, deleted-note exclusion, old-name collisions and shared annotation-array isolation.
- Stable refusal for encryption, signatures, XFA, malformed annotation arrays, unsupported rotation and cross-paper notes.

These tests verify one independent PDF reader implementation. Before calling broad external-reader support complete, open the synthetic exported fixture in Preview and another viewer such as Acrobat or Firefox: inspect Chinese popup contents, verify highlights and rotated underlines visually, edit a mark, and check that an original annotation and link still work. A screenshot of a rasterized page alone is insufficient. The current tests produce a temporary synthetic PDF and a four-rotation contact sheet for inspection; no personal paper data is used.

## Why this approach

Zotero also stores annotations in its database and offers an exported copy with embedded annotations. That separation avoids rewriting the source PDF during every edit while still providing an exit path. Its documentation explicitly describes this portable export. [Zotero annotation storage and export](https://www.zotero.org/support/kb/annotations_in_database)

Zotero's document-worker runs in Node for testing/tooling but is a larger worker stack with an AGPLv3 license; its implementation was not copied into this MIT project. `pdf-lib` is MIT-licensed and can modify existing PDFs in Node without a system runtime. The tradeoff is that general markup annotations require carefully tested low-level dictionaries and appearance streams instead of a high-level annotation API. [Zotero document-worker](https://github.com/zotero/document-worker), [Zotero license](https://github.com/zotero/document-worker/blob/master/COPYING), [pdf-lib license](https://github.com/Hopding/pdf-lib/blob/master/LICENSE.md)
