export function validateDiagram(source:string):string;
export type ChartData={type:'bar'|'line';title:string;unit:string;source:string;data:{label:string;value:number}[]};
export function parseChart(source:string):ChartData;
export const readingVisualInstructions:string;
