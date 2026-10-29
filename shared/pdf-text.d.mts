export type PdfTextItem={str:string;hasEOL?:boolean;width?:number;height?:number;transform?:number[]};
export type PdfTextRun={itemIndex:number;start:number;end:number};
export function isTextItem(item:unknown):item is PdfTextItem;
export function normalizeWithOffsets(raw:string):{text:string;starts:Uint32Array;ends:Uint32Array};
export function indexPdfTextPage(items:readonly unknown[],page:number):{page:number;text:string;starts:Uint32Array;ends:Uint32Array;runs:PdfTextRun[]};
export function assemblePdfText(items:readonly unknown[]):{raw:string;runs:PdfTextRun[]};
