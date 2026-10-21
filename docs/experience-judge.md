# Independent reading experience review

Date: 2026-10-22. Final decision: **PASS for the reviewed local reading workflow**.

This decision follows two rejected iterations and a third browser review. It is not a claim of pixel identity, universal feature parity, scientific correctness of generated answers, or absence of all bugs. The judge did not edit implementation code and explored the reference before inspecting the local application.

## Reference and method

Reference: [alphaXiv paper 2610.04158](https://www.alphaxiv.org/abs/2610.04158), including its PDF view. The reference was explored in independent Chrome and in-app browser tabs. No public comment or message was submitted on alphaXiv. Local interactions used the same public 44-page paper.

Manual review used real clicks, text dragging, scrolling, screenshots, and read-only DOM measurements. Viewports covered 1440 × 900 desktop, 670 × 608 narrow window, and 390 × 664 mobile layout. These are browser viewport checks, not physical phone or mobile keyboard tests. Existing automated tests were not used as a substitute for this review.

Observed reference behavior:

- At 1440 × 900, opening the assistant creates an approximately 678-pixel-wide, nearly full-height right panel. The paper column reflows beside it. At 390 pixels, the assistant becomes a near-full-screen sheet.
- The reference PDF has a compact approximately 48-pixel top toolbar and continuous pages. Scrolling from page 1 into page 2 updates the page indicator without requiring a page button.
- Dragging over PDF text highlights the selection and opens a nearby question composer with explain and translate actions.
- Figures are cropped illustrations within the narrative, accompanied by captions and source-page links. Summary body text is approximately 16 pixels with 28-pixel line height.
- The reference's 670-pixel layout retains a narrow side panel and compresses its title into a very narrow column. Matching that particular weakness was not a release requirement; a usable overlay is preferable.

## Rejected iterations

| Round | Decision | Evidence and required change |
| --- | --- | --- |
| 1 | FAIL | The assistant was still a roughly 440-pixel floating window covering the reading text. The narrow PDF also spent approximately 136 vertical pixels on application chrome before the paper began. Summary typography and oversized illustrations needed correction. |
| 2 | FAIL | The dock, reflow, typography, and PDF area improved, but loading at a narrow width and then enlarging to desktop left the default assistant at 420 pixels. This is a realistic desktop-app resize sequence, so a fresh desktop-only screenshot was insufficient. |
| 3 | PASS | Narrow-to-desktop initialization now produces a 662-pixel dock at 1440 pixels. Figures have a separate zoomable viewer, and the core desktop/narrow/mobile checks below passed. |

## Final manual checks

- **Desktop assistant:** the 662-pixel panel occupies almost the full viewport height, with the paper reflowing beside it. The close control, history, model selector, question field, and send action remain accessible. A real answer and its selected source text fit in the wide conversation area.
- **Responsive initialization:** refreshed at 390 pixels, enlarged to 1440 pixels, then opened the assistant; its width was 662 pixels, not the previous erroneous 420 pixels.
- **Narrow and mobile assistant:** at 670 × 608 the overlay is approximately 560 pixels wide and has an explicit “return to paper” action. At 390 × 664 it occupies the viewport. Conversation content scrolls independently of the composer. Model selection and close/return controls stay visible.
- **Reading progress:** scrolled to page 3, closed and reopened the assistant, and retained the same page and nearby paragraph. Switching to the summary and back retained page 3. Following a figure source to page 4 and returning from the narrow assistant retained page 4.
- **Continuous PDF:** consecutive pages render in the same scrolling region. The desktop reading area begins at approximately 90 pixels and extends to the viewport bottom; narrow layout uses approximately 98 pixels of top controls. Zoom, fit width, page navigation, selectable text, and source links remain available.
- **Selection-to-answer:** dragged over page 3, entered a Chinese question in the nearby popup, transferred the question and a page-tagged excerpt to the assistant, and sent it to the configured real model. The application displayed a Chinese answer about the selected experimental setup. No alphaXiv service was used for this local answer.
- **Summary typography:** measured local summary prose at 16 pixels / 28-pixel line height and 908-pixel width at the reviewed desktop layout. Illustrations are centered with a 760-pixel maximum width.
- **Figures:** visually confirmed that Figure 1 and Figure 2 contain the actual cropped diagram/chart, not entire PDF pages, and sit beside the corresponding explanation. “View original” opens the correct source page. At 390 pixels the figure dialog fits within the viewport; 150% zoom and horizontal scrolling reveal both left and right chart columns. Closing it returns to the surrounding summary.
- **Language and agent entry points:** Chinese abstract and illustrated explanation are visible. The UI exposes eight reading-language choices, translation actions, and Codex/Claude task entry points. Multi-connection settings expose multiple model IDs sharing one endpoint/key. This review inspected those controls without changing the user's provider configuration; it did not claim to retest every language/provider combination.

Local screenshots are retained under the ignored `release/` directory: `judge-final-desktop-dock.png`, `judge-final-narrow-dock.png`, `judge-round2-mobile-chat.png`, `judge-final-mobile-figure.png`, and `judge-final-figures.png`. They are runtime review evidence and are not required in a portable source package.

## Remaining non-blocking differences

- The paper title remains in its original language even when the abstract/explanation is translated.
- The local PDF uses two compact control rows rather than the reference's single toolbar; the remaining difference is approximately 40–50 vertical pixels, not the previous large padded reading container.
- Annotation/notebook, social discussion, audio overview, recommendations, and other alphaXiv account features are outside this reading-workflow acceptance. No parity claim is made for those features.
- Mobile browser keyboard behavior, Safari/Firefox, scanned-PDF OCR, and all combinations of provider/language were not independently checked in this round.
- Generated answers can still overinterpret evidence. The successful live answer verifies the selection and delivery flow, not universal factual reliability.

No unresolved P0/P1 issue was found in the final reviewed reading sequence. The release remains subject to the repository's build, backend, and browser regression checks.


## Release regression follow-up

After the independent review, the release runner completed 25/25 backend checks and 32/32 browser scenarios, including the responsive dock and figure viewer. Six repeated selection scenarios also passed after the test waited for the final rendered text geometry. TypeScript and the production build passed. This closes the regression condition attached to the scoped PASS above.
