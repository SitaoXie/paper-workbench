import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Globe2,
  Info,
  FileText,
  Loader2,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Mark from "./Markdown";
import ReadingSections from "./ReadingSections";
import { parseReadingSectionLocation, readingSections, readingSectionUrl, type ReadingSectionLocation } from "./reading-sections";
import SelectionTools from "./SelectionTools";
import VisionTools from "./VisionTools";
import InteractiveReading from "./InteractiveReading";
import { ModelSelect } from "./ReadingTools";
import {
  api,
  type Paper,
  type ReadingStyle,
  type ReadingVersion,
  type Settings,
} from "./types";
import { getLocale, t } from "./i18n";
import { buildAgentReadingTask, type AgentReadingAssistance } from "./agent-task";
import { markReadingTranslationApplied, startReadingTranslation, translationSource, useReadingTranslationJob } from "./reading-translation-jobs";
import { figureCaption, missingFigureCaptions } from "./figure-captions";
import { portableReadingMarkdown } from "./portable-answer";
import { positionHash, type OverviewReadingContext } from "./reading-position";
import ReadingTranslationBridge from './ReadingTranslationBridge';
import {buildReadingTranslationTask,resolveReadingTranslationTaskMode} from './reading-translation-task';
import ReadingInteractiveBridge from './ReadingInteractiveBridge';
import {buildReadingInteractiveTask} from './reading-interactive-task';

type SubscriptionTranslationMode='translation'|'captions'|'interactive';
type SubscriptionTranslation={paperId:string;readingId:string;language:string;mode:SubscriptionTranslationMode;source:string;task:string};
type SubscriptionInteractive={paperId:string;sourceReadingId:string;expectedSourceRevision:string;agentTaskId:string;source:string;task:string;resultId?:string;stale?:boolean;dismissed?:boolean};
const interactiveTaskSource=(version:ReadingVersion,paper:Paper)=>JSON.stringify([version.markdown,version.language||'en',version.style,version.focus,version.title,version.figures||paper.figures||[],version.createdAt,version.source,version.pdfRevision,version.figuresRevision]);
const matchesInteractiveTask=(version:ReadingVersion,binding:SubscriptionInteractive)=>version.agentTaskId===binding.agentTaskId&&version.derivedFromReadingId===binding.sourceReadingId&&version.derivedSourceRevision===binding.expectedSourceRevision&&version.format==='interactive'&&version.interactive?.schemaVersion===1&&version.interactive.blocks.length>0;

export function readingVersions(paper: Paper): ReadingVersion[] {
  if (paper.readingVersions?.length) return [...paper.readingVersions].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  // Older clients/fixtures can still expose the two legacy content fields.
  const versions: ReadingVersion[] = [];
  if (paper.summary)
    versions.push({
      ...paper.summary,
      id: "legacy-summary",
      mode: "agent",
      style: "quick",
      createdAt: paper.summary.createdAt || paper.createdAt,
      figures: paper.figures,
      translations: Object.fromEntries(
        Object.entries(paper.translations || {}).flatMap(([lang, targets]) =>
          targets.summary ? [[lang, targets.summary]] : [],
        ),
      ),
    });
  if (paper.report)
    versions.push({
      ...paper.report,
      id: "legacy-report",
      style: "deep",
      figures: paper.figures,
      translations: Object.fromEntries(
        Object.entries(paper.translations || {}).flatMap(([lang, targets]) =>
          targets.report ? [[lang, targets.report]] : [],
        ),
      ),
    });
  return versions;
}
const styleLabel = (style: string) =>
  style === "quick"
    ? t("快速了解", "Quick read")
    : style === "critical"
      ? t("批判性阅读", "Critical read")
      : t("深入研读", "Deep read");
function saveFile(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ReadingOverview({
  active = true,
  paper,
  language,
  original,
  settings,
  onSettings,
  onConfigure,
  onUpdated,
  onPage,
  onSource,
  onError,
  onBusy,
  onAskSelection,
  initialPresentation,
  historyNavigation,
  positionContext,
  onReadingContextChange,
  onManageFigures,
}: {
  active?: boolean;
  initialPresentation?: "article" | "interactive";
  historyNavigation?: {readingId?:string;presentation:'article'|'interactive';revision:number};
  positionContext?: string;
  onReadingContextChange?: (context: OverviewReadingContext) => void;
  onManageFigures?: () => void;
  paper: Paper;
  language: string;
  original: boolean;
  settings: Settings;
  onSettings: (value: Settings) => void;
  onConfigure: () => void;
  onUpdated: (paper: Paper) => void;
  onPage: (page: number, quote?: string) => void;
  onSource?: (source:'abstract'|'text') => void;
  onError: (message: string) => void;
  onBusy?: (value: boolean) => void;
  onAskSelection: (text: string, label: string, question?: string, source?: {sourceScope:'reading'|'abstract';readingId?:string}) => Promise<boolean>;
}) {
  const versions = readingVersions(paper);
  const proseRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const position = () => {
      const bounds = toolbar.getBoundingClientRect(), viewport = window.visualViewport?.height || innerHeight;
      toolbar.querySelectorAll<HTMLDetailsElement>(":scope > details[open]").forEach(details => {
        const body = details.querySelector<HTMLElement>(":scope > .reading-version-detail-body, :scope > .vision-tools-body");
        if (!body) return;
        const below = viewport - bounds.bottom - 14, above = bounds.top - 14;
        const useAbove = below < 230 && above > below;
        body.dataset.side = useAbove ? "above" : "below";
        body.style.setProperty("--reading-popover-height", `${Math.max(120, Math.min(640, useAbove ? above : below))}px`);
      });
    };
    const toggle = (event: Event) => {
      const opened = event.target;
      if (!(opened instanceof HTMLDetailsElement) || opened.parentElement !== toolbar || !opened.open) return;
      toolbar.querySelectorAll<HTMLDetailsElement>(":scope > details[open]").forEach(item => { if (item !== opened) item.open = false; });
      position();
    };
    toolbar.addEventListener("toggle", toggle, true);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    return () => { toolbar.removeEventListener("toggle", toggle, true); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => { if (detailsRef.current) detailsRef.current.open = false; }, [paper.id, active]);
  const [sectionIntent, setSectionIntent] = useState<(ReadingSectionLocation & { revision: number }) | undefined>(() => {
    const anchor = parseReadingSectionLocation(location.href, paper.id);
    return anchor ? { ...anchor, revision: 1 } : undefined;
  });
  const [sectionNoticeDismissed, setSectionNoticeDismissed] = useState(false);
  const [selected, setSelected] = useState(
    sectionIntent?.readingId || paper.activeReadingId || versions[0]?.id || "",
  );
  const [generating, setGenerating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const selectedRef = useRef(selected);
  // A late failed write must not roll back a newer read-only source navigation.
  const selectionIntent = useRef(0);
  // A restored fixed version is a local reading choice. A later detail/poll
  // response may update the library's active version without replacing it.
  const restoredVersionChoice = useRef(false);
  const [configure, setConfigure] = useState(!versions.length);
  const [format, setFormat] = useState<"article"|"interactive">("article");
  const [presentation, setPresentation] = useState<"article"|"interactive">(initialPresentation || (versions.find(v=>v.id===(paper.activeReadingId || versions[0]?.id))?.format === "interactive" ? "interactive" : "article"));
  const presentationVersion = useRef(paper.activeReadingId || versions[0]?.id);
  useLayoutEffect(()=>{
    if(!historyNavigation||parseReadingSectionLocation(location.href,paper.id))return;
    selectionIntent.current+=1;
    setSectionIntent(undefined);
    const id=historyNavigation.readingId;
    if(id&&versions.some(version=>version.id===id)){
      restoredVersionChoice.current=true;
      selectedRef.current=id;setSelected(id);presentationVersion.current=id;
    }
    setPresentation(historyNavigation.presentation);
  },[historyNavigation?.revision]);
  const [exporting, setExporting] = useState(false);
  const [style, setStyle] = useState<ReadingStyle>("quick");
  const [focus, setFocus] = useState("");
  const [copied, setCopied] = useState(false);
  const [agentAssistance, setAgentAssistance] = useState<AgentReadingAssistance>('none');
  const [preparedAgentTask, setPreparedAgentTask] = useState<{ key: string; task: string } | null>(null);
  const agentTaskKey = JSON.stringify([paper.id, language, getLocale(), style, format, focus.trim(), agentAssistance, paper.abstractIsExcerpt]);
  const agentTask = preparedAgentTask?.key === agentTaskKey ? preparedAgentTask.task : '';
  const [translationTasks,setTranslationTasks]=useState<Record<string,SubscriptionTranslation>>({});
  const [interactiveTasks,setInteractiveTasks]=useState<Record<string,SubscriptionInteractive>>({});
  const [preparingInteractive,setPreparingInteractive]=useState<Set<string>>(new Set());
  const interactiveTaskRef=useRef(interactiveTasks);interactiveTaskRef.current=interactiveTasks;
  const interactivePreparations=useRef(new Map<string,number>());
  const interactiveRefreshes=useRef(new Map<string,number>());
  const latestPaper=useRef(paper);latestPaper.current=paper;
  const translationRefreshes=useRef(new Map<string,number>());
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const previousLanguage = useRef(language);
  const autoTranslation = useRef<{id:string,language:string}|undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (paper.activeReadingId && !sectionIntent && !restoredVersionChoice.current) { setSelected(paper.activeReadingId); selectedRef.current = paper.activeReadingId; }
  }, [paper.activeReadingId]);
  const version = versions.find((v) => v.id === selected) || versions[0];
  const sourceFigures = version?.figures || paper.figures || [];
  const translationTaskKey=JSON.stringify([paper.id,version?.id,language]);
  const subscriptionTranslation=translationTasks[translationTaskKey];
  const interactiveTaskKey=JSON.stringify([paper.id,version?.id]);
  const subscriptionInteractive=interactiveTasks[interactiveTaskKey];
  const sourceIdentity = version ? translationSource({ ...version, figures: version.figures || paper.figures }) : "";
  const storedJob = useReadingTranslationJob(paper.id, version?.id || "", language);
  const translationJob = storedJob?.source === sourceIdentity ? storedJob : undefined;
  const translating = storedJob?.status === "pending";
  const translation = original ? undefined : version?.translations?.[language];
  const cachedTranslation = translation && !translation.stale ? translation : undefined;
  const completedTranslation = !original && translationJob?.status === "success" ? translationJob.result : undefined;
  const cachedNeedsSupplement = !!cachedTranslation && ((!!version?.interactive && (!cachedTranslation.interactive || !!cachedTranslation.interactiveTranslationError)) || !!cachedTranslation.captionTranslationError || missingFigureCaptions(sourceFigures, cachedTranslation.figureCaptions).length > 0);
  const canCompleteTranslation = translationJob?.status === "success" && !translationJob.applied && cachedNeedsSupplement && completedTranslation?.markdown === cachedTranslation?.markdown;
  const translated = !cachedTranslation || canCompleteTranslation ? completedTranslation || cachedTranslation : cachedTranslation;
  const markdown = translated?.markdown || version?.markdown || "";
  const interactive = translated ? translated.interactiveTranslationError ? undefined : translated.interactive : version?.interactive;
  const needsInteractiveTranslation = !!translated && !!version?.interactive && !interactive;
  const needsCaptionTranslation = !original && missingFigureCaptions(sourceFigures, translated?.figureCaptions).length > 0;
  const captionPresentation = { figureCaptions: original ? undefined : translated?.figureCaptions, captionLanguage: original ? undefined : language };
  const visiblePresentation = interactive ? presentation : "article";
  useEffect(() => {
    if (presentationVersion.current !== version?.id) {
      presentationVersion.current = version?.id;
      setPresentation(version?.format === "interactive" ? "interactive" : "article");
    }
  }, [version?.id]);
  const readingContextKey = positionHash(JSON.stringify([positionContext, version?.id, language, original, visiblePresentation, markdown, visiblePresentation === "interactive" ? interactive : null, sourceFigures, translated?.figureCaptions]));
  const contextCallback = useRef(onReadingContextChange);
  contextCallback.current = onReadingContextChange;
  useLayoutEffect(() => {
    contextCallback.current?.({ key: readingContextKey, versionId: version?.id, language, presentation: visiblePresentation });
  }, [readingContextKey]);
  const sections = useMemo(() => readingSections(markdown), [markdown]);
  const sectionVersionAvailable = !sectionIntent || versions.some(item => item.id === sectionIntent.readingId);
  const sectionExists = !sectionIntent || sectionIntent.section === 0 || sections.some(item => item.index === sectionIntent.section);
  useEffect(() => {
    const changed = () => {
      selectionIntent.current += 1;
      const anchor = parseReadingSectionLocation(location.href, paper.id);
      setSectionNoticeDismissed(false);
      setSectionIntent(anchor ? { ...anchor, revision: Date.now() } : undefined);
      if (anchor) { setSelected(anchor.readingId); selectedRef.current = anchor.readingId; setPresentation("article"); }
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [paper.id]);
  useEffect(() => { if (sectionIntent && sectionVersionAvailable) setPresentation("article"); }, [sectionIntent, sectionVersionAvailable]);
  const navigateSection = useCallback((index: number) => {
    if (!version) return;
    selectionIntent.current += 1;
    const destination = readingSectionUrl(location.href, paper.id, version.id, index);
    if (destination !== location.href) history.pushState({...history.state,paperWorkbench:history.state?.paperWorkbench?{...history.state.paperWorkbench,entryId:crypto.randomUUID(),tab:'summary'}:undefined}, "", destination);
    setSectionNoticeDismissed(false);
    setSectionIntent(previous => ({ readingId: version.id, section: index, revision: (previous?.revision || 0) + 1 }));
  }, [version?.id, paper.id]);
  const sectionNavigation = useMemo(() => version ? { readingId: version.id, sections, href: (index: number) => readingSectionUrl(location.href, paper.id, version.id, index), onNavigate: navigateSection } : undefined, [version?.id, sections, paper.id, navigateSection]);
  const sourceLanguage = version?.language || "en";
  const needsTranslation =
    !!version &&
    !original &&
    !translated &&
    !sourceLanguage
      .toLowerCase()
      .startsWith(language.split("-")[0].toLowerCase());
  const modelReady = settings.modelConfigured ?? settings.apiKeyConfigured;
  useEffect(() => {
    if (!version || translationJob?.status !== "success") return;
    const result = translationJob.result;
    const cached = version.translations?.[language];
    if (cached === result || (cached && !cached.stale && !canCompleteTranslation)) return;
    // Merge just this source-bound translation into the latest displayed paper.
    // A completed request must not restore an older active version or snapshot.
    if (["legacy-summary", "legacy-report"].includes(version.id)) {
      const target = version.id === "legacy-summary" ? "summary" : "report";
      onUpdated({ ...paper, translations: { ...paper.translations, [language]: { ...paper.translations?.[language], [target]: result } } });
    } else {
      onUpdated({ ...paper, activeReadingId: selectedRef.current, readingVersions: paper.readingVersions?.map(item => item.id === version.id ? { ...item, translations: { ...item.translations, [language]: result } } : item) });
    }
    // A later public-paper validation may remove rejected cards. Do not revive
    // them from a previously applied in-memory result on another navigation.
    markReadingTranslationApplied(paper.id, version.id, language, translationJob);
  }, [paper, version?.id, language, translationJob, canCompleteTranslation, onUpdated]);
  useEffect(() => {
    if (previousLanguage.current !== language) {
      previousLanguage.current = language;
      autoTranslation.current = version ? {id:version.id,language} : undefined;
    }
    if (!active) return;
    const requested = autoTranslation.current;
    if (!requested || requested.id !== version?.id || requested.language !== language || original) return;
    if (!needsTranslation) { autoTranslation.current = undefined; return; }
    if (translationJob?.status === "error") { autoTranslation.current = undefined; return; }
    if (!modelReady || translating || generating) return;
    autoTranslation.current = undefined;
    void translate();
  }, [active, language, version?.id, original, needsTranslation, modelReady, translating, generating, translationJob]);
  const source =
    version?.source?.agent ||
    version?.source?.model ||
    (version?.mode === "extractive"
      ? t("原文摘录", "Source excerpts")
      : t("模型", "Model"));
  const publish = (value: Paper) => {
    if (mounted.current) onUpdated(value);
  };
  async function choose(id: string) {
    if (choosing) return;
    const intent = ++selectionIntent.current;
    const previous = selected;
    setSectionIntent(undefined);
    if (parseReadingSectionLocation(location.href, paper.id)) {
      const url = new URL(location.href); url.hash = ""; history.replaceState(history.state, "", url.href);
    }
    selectedRef.current = id;
    setSelected(id);
    setError("");
    if (["legacy-summary", "legacy-report"].includes(id)) return;
    setChoosing(true);
    try {
      publish(
        (
          await api<{ paper: Paper }>(`/papers/${paper.id}`, {
            method: "PATCH",
            body: JSON.stringify({ activeReadingId: id }),
          })
        ).paper,
      );
    } catch (e) {
      if (mounted.current && selectionIntent.current === intent && selectedRef.current === id) {
        selectedRef.current = previous;
        setSelected(previous);
        setError((e as Error).message);
      }
    } finally { if (mounted.current) setChoosing(false); }
  }
  async function generate() {
    if (generating) return;
    setGenerating(true);
    onBusy?.(true);
    setError("");
    try {
      const response = await api<{ paper: Paper }>(
        `/papers/${paper.id}/report`,
        {
          method: "POST",
          body: JSON.stringify({
            language,
            style,
            format,
            focus: focus.trim(),
            adversarial: style !== "quick",
          }),
        },
      );
      publish(response.paper);
      if (mounted.current) {
        const generatedId=response.paper.activeReadingId||readingVersions(response.paper)[0]?.id||"";
        selectedRef.current=generatedId;setSelected(generatedId);
        setConfigure(false);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setGenerating(false);
      onBusy?.(false);
    }
  }
  function translate(interactiveOnly = false) {
    if (!version || translating) return;
    if (!modelReady) {
      prepareSubscriptionTranslation(interactiveOnly?'interactive':needsTranslation?'translation':'captions');
      return;
    }
    if (interactiveOnly) setPresentation("interactive");
    setError("");
    startReadingTranslation({ paperId: paper.id, versionId: version.id, language, source: sourceIdentity, load: async () => {
      const body = ["legacy-summary", "legacy-report"].includes(version.id)
        ? {
            target: version.id === "legacy-summary" ? "summary" : "report",
            language,
          }
        : { target: "reading", readingId: version.id, language };
      const response = await api<{ paper: Paper }>(`/papers/${paper.id}/translate`, {
        method: "POST", body: JSON.stringify(body),
      });
      if (response.paper.id !== paper.id) throw new Error(t("译文与论文不匹配，请重试。", "The translation did not match this paper. Please retry."));
      const returnedVersion = readingVersions(response.paper).find(item => item.id === version.id);
      if (!returnedVersion || translationSource({ ...returnedVersion, figures: returnedVersion.figures || response.paper.figures }) !== sourceIdentity) throw new Error(t("原解读已变化，请根据当前版本重试翻译。", "The source reading changed. Retry translation for the current version."));
      const result = returnedVersion.translations?.[language];
      if (!result?.markdown || result.stale) throw new Error(t("模型没有返回当前版本的有效译文，请重试。", "No valid translation was returned for this version. Please retry."));
      return result;
    } });
  }
  function prepareSubscriptionTranslation(mode:SubscriptionTranslationMode){
    if(!version)return;
    const cache=version.translations?.[language];
    const hasValidTargetArticle=!!cache?.markdown?.trim()&&!cache.stale;
    const resolvedMode=resolveReadingTranslationTaskMode({mode,language,sourceLanguage:version.language,hasValidTargetArticle});
    const task=buildReadingTranslationTask({origin:location.origin,paperId:paper.id,readingId:version.id,language,locale:language,mode:resolvedMode,sourceLanguage:version.language,sourceCreatedAt:version.createdAt,hasValidTargetArticle});
    setTranslationTasks(current=>({...current,[translationTaskKey]:{paperId:paper.id,readingId:version.id,language,mode:resolvedMode,source:sourceIdentity,task}}));
  }
  async function refreshSubscriptionTranslation(binding:SubscriptionTranslation){
    const key=JSON.stringify([binding.paperId,binding.readingId,binding.language]);
    const epoch=(translationRefreshes.current.get(key)||0)+1;
    translationRefreshes.current.set(key,epoch);
    const initial=latestPaper.current;
    const initialTranslation=JSON.stringify(readingVersions(initial).find(item=>item.id===binding.readingId)?.translations?.[binding.language]);
    const response=await api<{paper:Paper}>(`/papers/${encodeURIComponent(binding.paperId)}`);
    const current=latestPaper.current;
    if(!mounted.current||current.id!==binding.paperId||translationRefreshes.current.get(key)!==epoch)return;
    if(response.paper.id!==binding.paperId)throw new Error(t('结果与论文不匹配，请重试。','The result does not match this paper. Please retry.'));
    const returned=readingVersions(response.paper).find(item=>item.id===binding.readingId);
    const selected=readingVersions(current).find(item=>item.id===binding.readingId);
    if(!returned||!selected||translationSource({...returned,figures:returned.figures||response.paper.figures})!==binding.source||translationSource({...selected,figures:selected.figures||current.figures})!==binding.source)
      throw new Error(t('原解读已变化，请为当前版本重新复制翻译任务。','The source reading changed. Copy a new task for the current version.'));
    // A concurrent provider job or another refresh may already have updated
    // this target. A snapshot fetched before that change must not replace it.
    if(JSON.stringify(selected.translations?.[binding.language])!==initialTranslation)return;
    const result=returned.translations?.[binding.language];
    if(!result||result.stale)return;
    // Refresh only this translation. An old task must not switch the active
    // reading, replace figures/notes, or erase another language's late result.
    if(['legacy-summary','legacy-report'].includes(binding.readingId)){
      const target=binding.readingId==='legacy-summary'?'summary':'report';
      onUpdated({...current,translations:{...current.translations,[binding.language]:{...current.translations?.[binding.language],[target]:result}}});
    }else onUpdated({...current,readingVersions:current.readingVersions?.map(item=>item.id===binding.readingId?{...item,translations:{...item.translations,[binding.language]:result}}:item)});
  }
  async function makeInteractive() {
    if (!version || generating || translating) return;
    if (!modelReady) { await prepareSubscriptionInteractive(); return; }
    setGenerating(true); onBusy?.(true); setError("");
    try {
      const response = await api<{paper: Paper}>(`/papers/${paper.id}/report`, {
        method: "POST", body: JSON.stringify({readingId: version.id, format: "interactive"}),
      });
      publish(response.paper);
      if (mounted.current && response.paper.activeReadingId) {
        selectedRef.current = response.paper.activeReadingId;
        setSelected(response.paper.activeReadingId);
      }
    } catch (reason) { if (mounted.current) setError((reason as Error).message); }
    finally { if (mounted.current) setGenerating(false); onBusy?.(false); }
  }
  async function prepareSubscriptionInteractive(newTask=false) {
    if(!version)return;
    const paperId=paper.id,sourceId=version.id,key=JSON.stringify([paperId,sourceId]);
    if(interactivePreparations.current.has(key))return;
    const existing=interactiveTaskRef.current[key];
    if(existing&&!newTask){setInteractiveTasks(current=>({...current,[key]:{...current[key],dismissed:false}}));return;}
    const identity=interactiveTaskSource(version,paper),epoch=Date.now();
    interactivePreparations.current.set(key,epoch);setPreparingInteractive(current=>new Set(current).add(key));setError('');
    try{
      let source=version;
      if(newTask||!source.derivationRevision||!/^[a-f0-9]{64}$/.test(source.derivationRevision)){
        const response=await api<{paper:Paper}>(`/papers/${encodeURIComponent(paperId)}`);
        const fresh=readingVersions(response.paper).find(item=>item.id===sourceId);
        if(response.paper.id!==paperId||!fresh||interactiveTaskSource(fresh,response.paper)!==identity)
          throw new Error(t('固定原版已变化，请重新打开论文并核对该版本后创建任务。','The fixed original changed. Reopen the paper and review that version before creating a task.'));
        source=fresh;
      }
      const current=latestPaper.current,currentSource=readingVersions(current).find(item=>item.id===sourceId);
      if(!mounted.current||current.id!==paperId||interactivePreparations.current.get(key)!==epoch)return;
      if(!currentSource||interactiveTaskSource(currentSource,current)!==identity)throw new Error(t('原版来源已变化，请重新核对后创建任务。','The original source changed. Review it before creating a task.'));
      if(!source.derivationRevision||!/^[a-f0-9]{64}$/.test(source.derivationRevision))throw new Error(t('服务端尚未提供固定版本校验信息，请更新服务后重试。','The server did not provide a fixed-version revision. Update the service and retry.'));
      if(currentSource.derivationRevision&&currentSource.derivationRevision!==source.derivationRevision)throw new Error(t('原版校验信息已变化，请重新打开论文后重试。','The source revision changed. Reopen the paper and retry.'));
      const binding:SubscriptionInteractive={paperId,sourceReadingId:sourceId,expectedSourceRevision:source.derivationRevision,agentTaskId:crypto.randomUUID(),source:identity,task:''};
      binding.task=buildReadingInteractiveTask({origin:location.origin,...binding,locale:language});
      interactiveTaskRef.current={...interactiveTaskRef.current,[key]:binding};
      setInteractiveTasks(current=>({...current,[key]:binding}));
    }catch(reason){if(mounted.current&&latestPaper.current.id===paperId)setError((reason as Error).message);}
    finally{interactivePreparations.current.delete(key);if(mounted.current)setPreparingInteractive(current=>{const next=new Set(current);next.delete(key);return next;});}
  }
  async function refreshSubscriptionInteractive(binding:SubscriptionInteractive){
    const key=JSON.stringify([binding.paperId,binding.sourceReadingId]),epoch=(interactiveRefreshes.current.get(binding.agentTaskId)||0)+1;
    interactiveRefreshes.current.set(binding.agentTaskId,epoch);
    const response=await api<{paper:Paper}>(`/papers/${encodeURIComponent(binding.paperId)}`);
    const current=latestPaper.current;
    if(!mounted.current||current.id!==binding.paperId||interactiveRefreshes.current.get(binding.agentTaskId)!==epoch||interactiveTaskRef.current[key]?.agentTaskId!==binding.agentTaskId)return;
    if(response.paper.id!==binding.paperId)throw new Error(t('互动结果与论文不匹配。','The interactive result does not match this paper.'));
    const returned=readingVersions(response.paper),currentVersions=readingVersions(current);
    const source=returned.find(item=>item.id===binding.sourceReadingId),currentSource=currentVersions.find(item=>item.id===binding.sourceReadingId);
    if(!source||!currentSource||source.derivationRevision!==binding.expectedSourceRevision||interactiveTaskSource(source,response.paper)!==binding.source||interactiveTaskSource(currentSource,current)!==binding.source||(currentSource.derivationRevision&&currentSource.derivationRevision!==binding.expectedSourceRevision)){
      setInteractiveTasks(tasks=>tasks[key]?.agentTaskId===binding.agentTaskId?{...tasks,[key]:{...tasks[key],stale:true}}:tasks);
      throw new Error(t('原版来源已变化，未合并旧任务结果。请核对来源后创建新任务。','The original source changed; the old task result was not merged. Review the source before creating a new task.'));
    }
    const results=returned.filter(item=>item.agentTaskId===binding.agentTaskId);
    if(!results.length)return;
    const result=results[0];
    if(results.length!==1||!matchesInteractiveTask(result,binding)||result.markdown!==source.markdown||(result.language||'en')!==(source.language||'en')||result.style!==source.style||result.focus!==source.focus||result.title!==source.title||JSON.stringify(result.figures||[])!==JSON.stringify(source.figures||response.paper.figures||[]))
      throw new Error(t('互动结果的固定版本或原文图表绑定不一致，未导入。','The interactive result does not preserve the fixed source or its figures; it was not imported.'));
    const existing=currentVersions.find(item=>item.id===result.id);
    const sameTask=currentVersions.filter(item=>item.agentTaskId===binding.agentTaskId);
    if((existing&&!matchesInteractiveTask(existing,binding))||sameTask.some(item=>item.id!==result.id))throw new Error(t('本地已有冲突的任务结果，未覆盖任何版本。','A conflicting local task result already exists. No version was overwritten.'));
    // Existing versions (including their newer translations) always win over
    // the fetched snapshot. Only this task's newly saved version is added.
    if(!existing){
      const merged={...current,readingVersions:[...(current.readingVersions||currentVersions),result]};
      latestPaper.current=merged;onUpdated(merged);
    }
    setInteractiveTasks(tasks=>tasks[key]?.agentTaskId===binding.agentTaskId?{...tasks,[key]:{...tasks[key],resultId:result.id,stale:false}}:tasks);
  }
  function openSubscriptionInteractive(binding:SubscriptionInteractive){
    const current=latestPaper.current,result=readingVersions(current).find(item=>item.id===binding.resultId);
    if(current.id!==binding.paperId||!result||!matchesInteractiveTask(result,binding)){setError(t('互动版暂不可用，请先刷新结果。','The interactive version is unavailable. Refresh its result first.'));return;}
    void choose(result.id);
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onError(
        t(
          "无法访问剪贴板，请手动复制或下载。",
          "Clipboard unavailable. Copy manually or download.",
        ),
      );
    }
  }
  function portableMarkdown() {
    return portableReadingMarkdown(markdown, paper, translated ? language : sourceLanguage,
      sourceFigures.map(figure=>({...figure,...figureCaption(figure,captionPresentation)})));
  }
  async function exportWebsite() {
    if (!version || exporting) return;
    setExporting(true); setError("");
    try {
      const {exportArticleHtml,exportInteractiveHtml} = await import("./interactive-export");
      const exportReading = visiblePresentation === "interactive" && interactive ? exportInteractiveHtml : exportArticleHtml;
      const result = await exportReading({paper,version:{...version,markdown},language:translated ? language : sourceLanguage,interactive,...captionPresentation});
      const link=document.createElement("a");
      const url=URL.createObjectURL(new Blob([result.html],{type:"text/html;charset=utf-8"}));
      link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      if(result.warnings.length) setError(result.warnings.join(" "));
    } catch(e) { setError((e as Error).message); } finally { setExporting(false); }
  }
  function prepareAgent() {
    const instruction = buildAgentReadingTask({
      origin: location.origin, paperId: paper.id, language, locale: getLocale(),
      abstractIsExcerpt: paper.abstractIsExcerpt, style, format, focus, assistance: agentAssistance,
    });
    setPreparedAgentTask({ key: agentTaskKey, task: instruction });
    void copy(instruction);
  }
  return (
    <section
      className="reading-overview"
      aria-label={t("阅读解读", "Reading overview")}
    >
      <div className="reading-overview-heading">
        <h2><Sparkles size={18} />{t("阅读解读", "Reading overview")}</h2>
        {version && <label className="reading-version-compact" title={`${t("解读版本", "Reading version")} · ${source}`}>
          <span aria-hidden="true">v{versions.length - versions.findIndex(item => item.id === version.id)} <ChevronDown size={12}/></span>
          <select aria-label={t("解读版本", "Reading version")} value={version.id} onChange={event => void choose(event.target.value)} disabled={generating || choosing}>
            {versions.map((item, i) => <option key={item.id} value={item.id}>{`v${versions.length - i} · ${["Summary", "Reading report", "Quick overview", "Deep reading", "Critical review"].includes(item.title || "") ? styleLabel(item.style) : item.title || styleLabel(item.style)} · ${item.language || "en"} · ${new Date(item.createdAt).toLocaleDateString(language)} · ${item.source?.agent || item.source?.model || t("模型", "Model")}`}</option>)}
          </select>
        </label>}
        <div className="reading-primary-actions">
          <button className="soft-button reading-configure-toggle" onClick={() => setConfigure(!configure)} aria-expanded={configure} aria-label={versions.length ? t("生成新版本", "New version") : t("阅读偏好", "Reading preferences")} title={versions.length ? t("生成新版本", "New version") : t("阅读偏好", "Reading preferences")}>
            <Settings2 size={15}/><span>{versions.length ? t("生成新版本", "New version") : t("阅读偏好", "Reading preferences")}</span>
          </button>
          {version && <>
            <button className="icon-button" aria-label={t("复制解读", "Copy overview")} title={t("复制解读", "Copy overview")} onClick={() => void copy(portableMarkdown())}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button>
            <button className="icon-button" aria-label={t("下载解读", "Download overview")} title={t("下载解读", "Download overview")} onClick={() => saveFile(portableMarkdown(), `${paper.title.slice(0, 70)}-${version.style}.md`)}><Download size={16}/></button>
          </>}
        </div>
      </div>
      {configure && (
        <div className="reading-preferences">
          <div
            className="reading-style-options"
            role="radiogroup"
            aria-label={t("阅读方式", "Reading style")}
          >
            {(
              [
                [
                  "quick",
                  t("快速了解", "Quick read"),
                  t(
                    "约 2 分钟 · 问题、贡献、结论",
                    "About 2 min · question, contribution, takeaway",
                  ),
                ],
                [
                  "deep",
                  t("深入研读", "Deep read"),
                  t(
                    "方法、证据、关键图与复现线索",
                    "Method, evidence, figures and reproduction",
                  ),
                ],
                [
                  "critical",
                  t("批判性阅读", "Critical read"),
                  t(
                    "假设、对照、边界与待核实项",
                    "Assumptions, controls, limits and open questions",
                  ),
                ],
              ] as const
            ).map(([value, label, description]) => (
              <button
                key={value}
                role="radio"
                aria-checked={style === value}
                className={style === value ? "selected" : ""}
                onClick={() => setStyle(value)}
                disabled={generating}
              >
                <strong>{label}</strong>
                <small>{description}</small>
              </button>
            ))}
          </div>
          <div className="reading-format-options" role="group" aria-label={t("阅读呈现", "Reading format")}>
            <button aria-pressed={format === "article"} onClick={()=>setFormat("article")} disabled={generating}><FileText size={15}/>{t("图文解读", "Reading article")}</button>
            <button aria-pressed={format === "interactive"} onClick={()=>setFormat("interactive")} disabled={generating}><Globe2 size={15}/>{t("交互阅读网页", "Interactive website")}</button>
          </div>
          {format === "interactive" && <p className="reading-format-hint">{t("概念卡、原文图表与自测问答，可导出为离线网页。", "Concept cards, source figures and self-checks, exportable as an offline website.")}</p>}
          <label className="reading-focus-label">
            {t("这次想重点看什么？", "What would you like to focus on?")}
            <textarea
              aria-label={t("解读侧重点", "Reading focus")}
              maxLength={3000}
              rows={3}
              placeholder={t(
                "例如：我想复现实验，请解释训练设置、关键消融和硬件需求。",
                "For example: I want to reproduce the experiments. Explain the training setup, key ablations and hardware needs.",
              )}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              disabled={generating}
            />
          </label>
          <details className="reading-agent-options">
            <summary>{t("Codex / Claude 辅助 skill（可选）", "Codex / Claude assistance skills (optional)")}</summary>
            <label className="reading-focus-label">
              {t("仅用于复制的订阅代理任务", "Only for copied subscription-agent tasks")}
              <select aria-label={t("订阅代理辅助 skill", "Subscription assistance skills")} value={agentAssistance} onChange={event => setAgentAssistance(event.target.value as AgentReadingAssistance)}>
                <option value="none">{t("项目阅读规范", "Project reading policy")}</option>
                <option value="supervisor">Supervisor-Skills</option>
                <option value="ars">ARS-Codex</option>
                <option value="both">Supervisor-Skills + ARS-Codex</option>
              </select>
            </label>
            <p className="muted-label">{t("只使用代理环境中可用且许可适用的 skill，不会自动安装。缺少时代理会说明，并使用项目阅读规范；不改变网站 API 生成。", "Uses skills available in the agent environment under applicable licenses; nothing is installed automatically. If unavailable, the agent discloses this and uses the project reading policy. Website API generation is unchanged.")}</p>
          </details>
          <div className="reading-generate-actions">
            <ModelSelect
              settings={settings}
              onChange={onSettings}
              disabled={generating || translating}
            />
            <button
              className="primary-button"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Sparkles size={15} />
              )}{" "}
              {generating
                ? t("正在研读…", "Reading…")
                : modelReady
                  ? t("生成解读", "Generate overview")
                  : t("生成原文摘录", "Create source excerpts")}
            </button>
            <button className="soft-button" onClick={prepareAgent}>
              <Code2 size={15} />
              {t("用 Codex / Claude", "Use Codex / Claude")}
            </button>
          </div>
          {!modelReady && (
            <p className="muted-label">
              {t("可用已有订阅生成，或", "Use an existing subscription, or ")}
              <button className="text-button" onClick={onConfigure}>
                {t("配置模型 API", "configure a model API")}
              </button>
            </p>
          )}
          {style !== "quick" && (
            <small className="muted-label">
              {t(
                "包含研究者、质疑者和编辑复核；多角色可能使用同一模型。",
                "Includes researcher, skeptic and editor review; roles may use the same model.",
              )}
            </small>
          )}
          {agentTask && (
            <div className="reading-agent-task">
              <textarea
                aria-label={t("解读代理任务", "Overview agent task")}
                readOnly
                value={agentTask}
                rows={5}
              />
              <button
                className="text-button"
                onClick={() => void copy(agentTask)}
              >
                <Copy size={13} />
                {t("复制任务", "Copy task")}
              </button>
            </div>
          )}
        </div>
      )}
      <div className="reading-secondary-toolbar" ref={toolbarRef}>
        {version && <>
          {version.interactive && <div className="reading-view-toggle" role="group" aria-label={t("查看方式", "View format")}>
            <button aria-pressed={visiblePresentation === "article"} onClick={()=>setPresentation("article")}>{t("文章", "Article")}</button>
            <button aria-pressed={visiblePresentation === "interactive"} onClick={()=>setPresentation("interactive")} disabled={!interactive}>{t("交互阅读", "Interactive")}</button>
          </div>}
          {!version.interactive && version.mode !== "extractive" && <>
            <button className="reading-tool-button reading-interactive-convert" disabled={generating || translating || preparingInteractive.has(interactiveTaskKey)} onClick={()=>void makeInteractive()} aria-label={t("将此版本转为互动导读", "Create an interactive version from this reading")} title={t("将此版本转为互动导读", "Create an interactive version from this reading")}>
              {generating||preparingInteractive.has(interactiveTaskKey) ? <Loader2 size={15} className="spin"/> : modelReady?<Sparkles size={15}/>:<Code2 size={15}/>}<span>{t("互动导读", "Interactive")}</span>
            </button>
            {modelReady&&<button className="reading-tool-button reading-interactive-subscription" disabled={preparingInteractive.has(interactiveTaskKey)} aria-label={t('用订阅制作互动版','Create an interactive version with a subscription')} title={t('用订阅制作互动版','Create an interactive version with a subscription')} onClick={()=>void prepareSubscriptionInteractive()}><Code2 size={15}/><span>{t('用订阅','Subscription')}</span></button>}
          </>}
          <button className="reading-tool-button reading-offline-export" disabled={exporting} aria-label={t("下载离线网页", "Download offline website")} title={t("下载离线网页", "Download offline website")} onClick={()=>void exportWebsite()}>{exporting ? <Loader2 size={15} className="spin"/> : <Globe2 size={15}/>}<span>{t("离线网页", "Offline website")}</span></button>
          <details className="reading-version-details" ref={detailsRef} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus({preventScroll:true}); } }}>
            <summary aria-label={t("版本详情", "Version details")} title={t("版本详情", "Version details")}><Info size={15}/><span>{t("版本详情", "Version details")}</span></summary>
            <div className="reading-version-detail-body">
              <dl><div><dt>{t("阅读方式", "Reading style")}</dt><dd>{styleLabel(version.style)}</dd></div>
                {version.derivedFromReadingId&&<div><dt>{t("原文章来源", "Original article")}</dt><dd>{version.articleSource?.agent||version.articleSource?.model||t("来源未记录", "Source not recorded")}</dd></div>}
                <div><dt>{version.derivedFromReadingId?t("互动内容来源", "Interactive companion"):t("生成来源", "Created with")}</dt><dd>{source}</dd></div><div><dt>{t("生成时间", "Created")}</dt><dd>{new Date(version.createdAt).toLocaleString(language)}</dd></div><div><dt>{t("原始语言", "Original language")}</dt><dd>{sourceLanguage}</dd></div></dl>
              {version.mode === "extractive" && <p>{t("原文摘录 · 未调用模型，不是独立分析。", "Source excerpts · No model used; this is not an independent analysis.")}</p>}
              {version.focus && <div className="reading-focus-record"><strong>{t("本版关注点", "Focus for this version")}</strong><p>{version.focus}</p></div>}
            </div>
          </details>
        </>}
        <VisionTools compact paper={paper} settings={settings} language={language} onConfigure={onConfigure} onPage={onPage} onManageFigures={onManageFigures} onUpdated={value=>publish({...value,activeReadingId:selectedRef.current})}/>
        {version && <div className="reading-provenance" aria-label={t("当前阅读来源与语言", "Current reading source and language")}>
          <span className="reading-boundary">{version.mode === "extractive" ? t("原文摘录", "Source excerpts") : t("AI 解读", "AI-generated")}</span>
          <span>{(translated ? language : sourceLanguage).startsWith("zh") ? "中文" : (translated ? language : sourceLanguage).startsWith("en") ? "English" : translated ? language : sourceLanguage}{translated && sourceLanguage.toLowerCase() !== language.toLowerCase() ? ` · ${t("译文", "translation")}` : ""}</span>
        </div>}
      </div>
      {error && (
        <div className="reading-inline-error" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label={t("关闭错误提示", "Dismiss error")}
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {version ? (
        <>
          {subscriptionInteractive&&!subscriptionInteractive.dismissed&&<ReadingInteractiveBridge key={subscriptionInteractive.agentTaskId} task={subscriptionInteractive.task} target={`${t('固定原版','Fixed original')} v${versions.length-versions.findIndex(item=>item.id===subscriptionInteractive.sourceReadingId)} · ${version.language||'en'}`} resultReady={!!subscriptionInteractive.resultId&&versions.some(item=>item.id===subscriptionInteractive.resultId&&matchesInteractiveTask(item,subscriptionInteractive))} opening={choosing} stale={!!subscriptionInteractive.stale} onRefresh={()=>refreshSubscriptionInteractive(subscriptionInteractive)} onOpen={()=>openSubscriptionInteractive(subscriptionInteractive)} onClose={()=>setInteractiveTasks(tasks=>({...tasks,[interactiveTaskKey]:{...tasks[interactiveTaskKey],dismissed:true}}))} onNewTask={()=>void prepareSubscriptionInteractive(true)}/>}
          {version.interactiveGenerationError && <div className="reading-inline-error" role="status"><span>{t("文章已保存，互动版暂未完成。可以只重试互动转换，无需重新研读。", "The article was saved, but the interactive version did not finish. Retry just the conversion without regenerating the reading.")}</span></div>}
          {needsTranslation && (
            <div className="translation-missing">
              <span>
                {translation?.stale
                  ? t(
                      "译文已过期，暂显示原文。",
                      "Translation is outdated; showing the original.",
                    )
                  : t(
                      "此版本尚无所选语言的译文，暂显示原文。",
                      "This version has no translation in the selected language; showing the original.",
                    )}
              </span>
              <button
                className="text-button"
                disabled={translating}
                onClick={() => void translate()}
              >
                {translating
                  ? t("正在翻译当前版本…", "Translating this version…")
                  : translationJob?.status === "error" ? t("重试翻译", "Retry translation")
                  : modelReady ? t("翻译此版本", "Translate this version") : t("用订阅翻译此版本", "Translate this version with a subscription")}
              </button>
              {modelReady&&<button className="text-button" onClick={()=>prepareSubscriptionTranslation('translation')}><Code2 size={13}/>{t('用 Codex / Claude','Use Codex / Claude')}</button>}
            </div>
          )}
          {needsInteractiveTranslation && <div className="translation-missing" role="status"><span>{t("文章译文已保存，互动卡片尚未完成翻译；当前显示文章译文。", "The article translation is saved. Interactive cards are not yet translated; showing the article.")}</span><button className="text-button" disabled={translating} onClick={() => translate(true)}>{translating ? t("正在翻译互动卡片…", "Translating interactive cards…") : modelReady?t("仅重试互动翻译", "Retry interactive translation"):t('用订阅翻译互动卡片','Translate cards with a subscription')}</button>{modelReady&&<button className="text-button" onClick={()=>prepareSubscriptionTranslation('interactive')}><Code2 size={13}/>{t('用 Codex / Claude','Use Codex / Claude')}</button>}</div>}
          {needsCaptionTranslation && !needsTranslation && !needsInteractiveTranslation && <div className="reading-presentation-actions">{translated?.captionTranslationError && !translating && <span className="muted-label" role="status">{t("图注翻译未完成。", "Caption translation is unfinished.")}</span>}<button className="text-button" disabled={translating} onClick={() => translate()} title={translated?.captionTranslationError || t("复用当前解读，只补译图注；图内文字保留原样。", "Reuse this reading and translate missing captions; text inside figures stays unchanged.")}>{translating ? t("正在翻译图注…", "Translating figure captions…") : !modelReady?t('用订阅补译图注','Translate captions with a subscription'):translated?.captionTranslationError || translationJob?.status === "error" ? t("重试图注翻译", "Retry caption translation") : t("补译图注", "Translate figure captions")}</button>{modelReady&&<button className="text-button" onClick={()=>prepareSubscriptionTranslation('captions')}><Code2 size={13}/>{t('用 Codex / Claude','Use Codex / Claude')}</button>}</div>}
          {subscriptionTranslation&&<ReadingTranslationBridge key={subscriptionTranslation.task} task={subscriptionTranslation.task} target={`${t('固定版本','Fixed version')} v${versions.length-versions.findIndex(item=>item.id===subscriptionTranslation.readingId)} · ${subscriptionTranslation.language.startsWith('zh')?'中文':'English'} · ${subscriptionTranslation.mode==='captions'?t('图注','Captions'):subscriptionTranslation.mode==='interactive'?t('互动卡片','Interactive cards'):t('正文与图注','Article and captions')}`} ready={!!translated&&!translated.stale&&(subscriptionTranslation.mode==='interactive'?!!interactive:subscriptionTranslation.mode==='captions'?!needsCaptionTranslation:!needsInteractiveTranslation&&!needsCaptionTranslation)} onRefresh={()=>refreshSubscriptionTranslation(subscriptionTranslation)} onClose={()=>setTranslationTasks(current=>{const next={...current};delete next[translationTaskKey];return next;})}/>}
          {(needsTranslation || needsInteractiveTranslation || needsCaptionTranslation) && translationJob?.status === "error" && <div className="reading-inline-error" role="alert"><span>{needsInteractiveTranslation ? t("互动翻译失败：", "Interactive translation failed: ") : needsCaptionTranslation && !needsTranslation ? t("图注翻译失败：", "Caption translation failed: ") : t("当前版本翻译失败：", "Translation failed for this version: ")}{translationJob.error}</span></div>}
          {needsInteractiveTranslation && translated?.interactiveTranslationError && translationJob?.status !== "error" && !translating && <p className="muted-label">{translated.interactiveTranslationError}</p>}
          {sectionIntent && (!sectionVersionAvailable || !sectionExists) && !sectionNoticeDismissed && <div className="reading-section-notice" role="status"><span>{!sectionVersionAvailable ? t("链接指向的解读版本不存在，当前显示已有版本。", "The linked reading version is unavailable; showing an existing version.") : t("链接指向的章节不存在，请从目录选择。", "The linked section is unavailable. Choose one from the contents.")}</span><button className="icon-button" aria-label={t("关闭章节提示", "Dismiss section notice")} onClick={() => setSectionNoticeDismissed(true)}><X size={13}/></button></div>}
          {visiblePresentation === "article" && <ReadingSections active={active} paperId={paper.id} readingId={version.id} contextKey={readingContextKey} sections={sections} contentRef={proseRef} intent={sectionVersionAvailable && sectionExists ? sectionIntent : undefined} onNavigate={navigateSection} onError={onError}/>}
          <div ref={proseRef} className={`reading-prose ${visiblePresentation === "interactive" ? "" : "prose"}`} data-reading-id={version.id}>
            <SelectionTools active={active} paperId={paper.id} readingId={version.id} scope="reading" language={language} model={settings.model} modelReady={!!modelReady} onAsk={onAskSelection}>
              {visiblePresentation === "interactive" && interactive ? <InteractiveReading interactive={interactive} figures={sourceFigures} pdfUrl={paper.localPdfUrl || paper.pdfUrl} onPage={onPage} onSource={onSource} language={translated ? language : sourceLanguage} {...captionPresentation}/> : <Mark sectionNavigation={sectionNavigation} onPage={onPage} onSource={onSource} figures={sourceFigures} pdfUrl={paper.localPdfUrl || paper.pdfUrl} {...captionPresentation}>{markdown}</Mark>}
            </SelectionTools>
          </div>
          {version.stages && version.stages.length > 1 && (
            <details className="review-trace">
              <summary>
                <ShieldCheck size={14} />
                {t("复核过程", "Review process")}
                <span>{version.stages.length}</span>
              </summary>
              {version.stages
                .filter((s) => s.role !== "editor")
                .map((s) => (
                  <div className="prose" key={s.role}>
                    <h3>
                      {s.role === "researcher"
                        ? t("研究者 · 初稿", "Researcher · draft")
                        : t("质疑者 · 审阅", "Skeptic · review")}
                    </h3>
                    <Mark onPage={onPage} onSource={onSource}>{s.content}</Mark>
                  </div>
                ))}
            </details>
          )}
        </>
      ) : (
        <div className="reading-empty">
          <FileText size={32} />
          <h3>
            {t(
              "选择一种方式，开始读懂这篇论文",
              "Choose how you want to read this paper",
            )}
          </h3>
          <p>
            {t(
              "一个清晰的解读区域，保留每一版和它的关注点。",
              "One clear overview, with every version and its focus preserved.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
