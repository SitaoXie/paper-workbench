import { ApiError } from "./network.mjs";

/** JSON.parse alone silently keeps the last duplicate key, including escaped aliases. */
export function assertUniqueJsonKeys(source) {
  try { JSON.parse(source); } catch { throw new ApiError("Invalid JSON."); }
  const stack = [];
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) || [];
  for (const token of tokens) {
    const current = stack.at(-1);
    if (token === "{") stack.push({ object: true, key: true, keys: new Set() });
    else if (token === "[") stack.push({ object: false });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && current?.object) current.key = true;
    else if (token.startsWith('"') && current?.object && current.key) {
      const key = JSON.parse(token);
      if (current.keys.has(key)) throw new ApiError("JSON objects must not repeat field names.");
      current.keys.add(key); current.key = false;
    }
  }
}
