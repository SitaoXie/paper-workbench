export type AssistantStyle = {id:string;name:string;nameEn?:string;prompt:string};
export type AssistantPreferences = {styleId:string;pdfMode:'text'|'images';webSearch?:boolean;answerMode?:'api'|'agent';customStyles:AssistantStyle[]};
export const BUILTIN_ASSISTANT_STYLES: readonly Readonly<AssistantStyle>[];
export const DEFAULT_ASSISTANT_PREFERENCES: Readonly<AssistantPreferences>;
export function assistantStyle(preferences?:AssistantPreferences):AssistantStyle;
