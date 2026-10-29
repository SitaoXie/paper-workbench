// Canonical PDF text assembly and normalization shared by navigation and source validation.
export function isTextItem(item) {
    return Boolean(item && typeof item === "object" && "str" in item && typeof item.str === "string");
}
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function separator(previous, current) {
    if (!previous.str || !current.str || /\s$/.test(previous.str) || /^\s/.test(current.str))
        return "";
    const before = Array.from(previous.str).at(-1) || "";
    const after = Array.from(current.str)[0] || "";
    const a = previous.transform, b = current.transform;
    const height = Math.max(1, previous.height || Math.abs(a?.[3] || 0), current.height || Math.abs(b?.[3] || 0));
    const lineBreak = previous.hasEOL || Boolean(a && b && Math.abs(a[5] - b[5]) > height * .6);
    if (cjk.test(before) && cjk.test(after))
        return "";
    if (lineBreak)
        return "\n";
    return a && b && b[4] - (a[4] + (previous.width || 0)) > height * .12 ? " " : "";
}
/** Case/ligature/whitespace normalization retains source UTF-16 offsets. */
export function normalizeWithOffsets(raw) {
    const skipped = new Set();
    for (const match of raw.matchAll(/[\p{L}][-\u2010\u2011]\s*\n\s*(?=\p{L})/gu)) {
        const start = match.index + Array.from(match[0])[0].length;
        for (let i = start; i < match.index + match[0].length; i++)
            skipped.add(i);
    }
    const text = [], starts = [], ends = [];
    let lastSpace = false;
    for (let i = 0; i < raw.length;) {
        const start = i;
        let group = String.fromCodePoint(raw.codePointAt(i));
        i += group.length;
        while (i < raw.length && /\p{M}/u.test(String.fromCodePoint(raw.codePointAt(i)))) {
            const mark = String.fromCodePoint(raw.codePointAt(i));
            group += mark;
            i += mark.length;
        }
        if (skipped.has(start) || group === "\u00ad")
            continue;
        let normalized = group.normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015]/g, "-");
        if (/^\s+$/u.test(normalized)) {
            let next = i;
            while (next < raw.length && /\s/.test(raw[next]))
                next++;
            if (cjk.test(Array.from(text.at(-1) || "").at(-1) || "") && cjk.test(String.fromCodePoint(raw.codePointAt(next) || 0)))
                continue;
            if (lastSpace) {
                if (ends.length)
                    ends[ends.length - 1] = i;
                continue;
            }
            normalized = " ";
            lastSpace = true;
        }
        else
            lastSpace = false;
        text.push(normalized);
        for (let j = 0; j < normalized.length; j++) {
            starts.push(start);
            ends.push(i);
        }
    }
    return { text: text.join(""), starts: Uint32Array.from(starts), ends: Uint32Array.from(ends) };
}
export function assemblePdfText(items) {
    const runs = [];
    let raw = "", previous;
    items.forEach((item, itemIndex) => {
        if (!isTextItem(item))
            return;
        if (previous)
            raw += separator(previous, item);
        runs.push({ itemIndex, start: raw.length, end: raw.length + item.str.length });
        raw += item.str;
        if (item.str)
            previous = item;
        else if (item.hasEOL && previous)
            previous = { ...previous, hasEOL: true };
    });
    return { raw, runs };
}

export function indexPdfTextPage(items,page){const {raw,runs}=assemblePdfText(items);return {page,...normalizeWithOffsets(raw),runs};}
