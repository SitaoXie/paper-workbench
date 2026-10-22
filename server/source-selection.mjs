import { ApiError } from "./network.mjs";
import { validatePage } from "./annotations.mjs";

/** Source anchors are explicit caller metadata, never inferred from prose. */
export function selectionPageBinding(input, paper, { defaultPage } = {}) {
  if (input.pages !== undefined) {
    if (!paper.filePath) throw new ApiError("pages requires a locally imported PDF source.");
    if (!Array.isArray(input.pages) || !input.pages.length || input.pages.length > 20)
      throw new ApiError("pages must contain between 1 and 20 source page numbers.");
    let previous = 0;
    const pages = input.pages.map(value => {
      const page = validatePage(value, paper);
      if (page <= previous) throw new ApiError("pages must be unique and strictly increasing.");
      previous = page; return page;
    });
    if (input.page !== undefined && validatePage(input.page, paper) !== pages[0])
      throw new ApiError("page must match the first entry in pages.");
    return { page: pages[0], pages };
  }
  const page = input.page === undefined ? defaultPage : input.page;
  return page === undefined ? {} : { page: validatePage(page, paper) };
}
