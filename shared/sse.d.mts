export function readSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<{event:string;data:string}>;
