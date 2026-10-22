import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Eye,
  FileText,
  Image,
  Loader2,
  Settings2,
  Sparkles,
} from "lucide-react";
import Mark from "./Markdown";
import { api, type Paper, type Settings, type VisualEvidence } from "./types";
import { cropPdfToPng } from "./pdf-crop";
import { sourceFigureLabel } from "./reading-figures";
import "./vision-tools.css";
const PdfFigure = lazy(() => import("./PdfFigure"));
import RecoverableFeature from "./RecoverableFeature";

// Exact allowlist: external/model-authored limitations remain visibly in their original language.
const systemLimitations = new Map([
  ["Pixels were submitted to the explicitly configured vision model; model conclusions are not independently verified.", "图像像素已发送给明确配置的视觉模型；模型结论未经独立核验。"],
  ["The client supplied the PDF crop pixels. The server validated the source reference, image type and dimensions, not pixel-level correspondence to the PDF.", "客户端提供了 PDF 裁切图像。服务端校验了来源引用、图像类型和尺寸，但未逐像素核验它与 PDF 是否一致。"],
  ["A crop may omit labels, legends or context. Do not infer unreadable values or treat a model description as a verified measurement.", "裁切图可能遗漏标签、图例或上下文。不要推测无法读清的数值，也不要把模型描述视为已核验的测量结果。"],
]);

type Props = {
  paper: Paper;
  settings: Settings;
  onUpdated: (paper: Paper) => void;
  onConfigure: () => void;
  onPage: (page: number) => void;
  language: string;
  compact?: boolean;
  onManageFigures?: () => void;
};

/** Vision is opt-in, independently configured, and never presented as ground truth. */
export default function VisionTools({
  paper,
  settings,
  onUpdated,
  onConfigure,
  onPage,
  language,
  compact = false,
  onManageFigures,
}: Props) {
  const english = language.startsWith("en");
  const t = (zh: string, en: string) => (english ? en : zh);
  const figures = (paper.figures || []).filter((figure) => figure.crop);
  const [selectedId, setSelectedId] = useState(figures[0]?.id || "");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState("");
  const [changingEvidence, setChangingEvidence] = useState("");
  const [revealedId, setRevealedId] = useState("");
  const [openResults, setOpenResults] = useState<Set<string>>(new Set());
  const resultRefs = useRef(new Map<string, HTMLDetailsElement>());
  const [stage, setStage] = useState<"crop" | "analyze">("crop");
  const controller = useRef<AbortController | null>(null);
  const request = useRef(0);
  const selected =
    figures.find((figure) => figure.id === selectedId) || figures[0];
  const profile = settings.profiles?.find(
    (item) => item.id === settings.vision?.profileId,
  );
  const visionModel = settings.vision?.model;
  const configured = !!(
    settings.vision?.enabled &&
    profile &&
    visionModel &&
    profile.models.includes(visionModel) &&
    profile.modelCapabilities?.[visionModel] === "vision"
  );
  const source = paper.localPdfUrl || paper.pdfUrl;
  // Array order is the server's append order, including equal timestamps.
  const evidence = [...(paper.visualEvidence || [])].reverse();
  const latestByFigure = new Map<string, string>();
  for (const item of evidence) if (!latestByFigure.has(item.figureId)) latestByFigure.set(item.figureId, item.id);
  useEffect(() => {
    if (!expanded || !revealedId || !evidence.some(item => item.id === revealedId)) return;
    const result = resultRefs.current.get(revealedId);
    if (!result) return;
    result.open = true;
    // Reveal completion inside the panel, without reopening a panel the reader closed.
    const frame = requestAnimationFrame(() => {
      const panel = detailsRef.current?.querySelector<HTMLElement>('.vision-tools-body');
      if (compact && panel) panel.scrollTop += result.getBoundingClientRect().top - panel.getBoundingClientRect().top - 14;
      setRevealedId("");
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, revealedId, paper.visualEvidence, compact]);
  useEffect(() => {
    if (!compact) return;
    const outside = (event: PointerEvent) => { if (detailsRef.current?.open && !detailsRef.current.contains(event.target as Node)) detailsRef.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [compact]);
  useEffect(() => {
    request.current += 1;
    controller.current?.abort();
    setBusy(false);
    setExpanded(false);
    setError("");
    setFocus("");
    setSelectedId("");
    setRevealedId("");
    setOpenResults(new Set());
    return () => {
      request.current += 1;
      controller.current?.abort();
    };
  }, [paper.id]);
  async function analyze() {
    if (!configured || !selected?.crop || !source || busy) return;
    const revision = ++request.current;
    const control = new AbortController();
    controller.current = control;
    setBusy(true);
    setError("");
    setStage("crop");
    try {
      const image = await cropPdfToPng(
        source,
        selected.page,
        selected.crop,
        control.signal,
      );
      if (request.current !== revision) return;
      setStage("analyze");
      const response = await api<{ evidence: VisualEvidence; paper: Paper }>(
        `/papers/${encodeURIComponent(paper.id)}/figures/${encodeURIComponent(selected.id)}/analyze`,
        {
          method: "POST",
          signal: control.signal,
          body: JSON.stringify({
            image: { mimeType: image.mimeType, data: image.data },
            page: selected.page,
            crop: selected.crop,
            language: english ? "en" : "zh-CN",
            focus: focus.trim() || undefined,
          }),
        },
      );
      if (request.current === revision) {
        onUpdated(response.paper);
        setRevealedId(response.evidence.id);
      }
    } catch (reason) {
      if (request.current === revision && !control.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : t("图像分析失败，请重试。", "Image analysis failed. Try again."),
        );
    } finally {
      if (request.current === revision) setBusy(false);
    }
  }
  async function toggleEvidence(item: VisualEvidence) {
    if (changingEvidence) return;
    if (item.excluded && (item.stale || latestByFigure.get(item.figureId) !== item.id)) return;
    setChangingEvidence(item.id); setError("");
    const revision = request.current;
    try {
      const result = await api<{paper: Paper}>(`/papers/${encodeURIComponent(paper.id)}/visual-evidence/${encodeURIComponent(item.id)}`, {
        method: "PATCH", body: JSON.stringify({excluded: !item.excluded}),
      });
      if (request.current === revision) onUpdated(result.paper);
    } catch (reason) { if (request.current === revision) setError((reason as Error).message); }
    finally { setChangingEvidence(""); }
  }
  return (
    <details ref={detailsRef} className={`vision-tools ${compact ? 'is-compact' : ''}`} key={paper.id} onToggle={event => setExpanded(event.currentTarget.open)} onKeyDown={event => {
      if (compact && event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus({preventScroll:true}); }
    }}>
      <summary aria-label={t("图像证据", "Image evidence")} title={t("图像证据", "Image evidence")}>
        <span>
          <Eye size={16} />
          <span className="vision-summary-label">{t("图像证据", "Image evidence")}</span>
          {!!evidence.length && <small>{evidence.length}</small>}
        </span>
        <span className="vision-summary-state">
          {evidence.length
            ? t("已收到图像 · 未独立核验", "Images received · Unverified")
            : t("尚无图像输入记录", "No image input recorded")}
        </span>
      </summary>
      <div className="vision-tools-body">
        {compact && <div className="vision-panel-heading"><strong>{t("图像证据", "Image evidence")}</strong><span>{evidence.length ? t("已收到图像 · 未独立核验", "Images received · Unverified") : t("尚无图像输入记录", "No image input recorded")}</span></div>}
        {onManageFigures && <button type="button" className="soft-button" onClick={onManageFigures}><Image size={15}/>{t("管理图表裁切", "Manage figure crops")}</button>}
        <p className="vision-evidence-boundary">
          {evidence.length
            ? t(
                "模型解释可能出错。新分析先单独保存，主动纳入后才用于后续解读和问答；现有解读保持不变。图表本身仍可正常阅读与引用。",
                "Model interpretations may be wrong. New analyses are saved separately until you include them in future readings and questions. Existing readings stay unchanged; source figures remain available.",
              )
            : t(
                "目前没有模型读取图像的记录。文字或图注解读不能代替检查图中内容；你可以主动发送下方裁切图。",
                "No model image input is recorded yet. Reading text or captions is not a substitute for inspecting the figure. You can explicitly send a source crop below.",
              )}
        </p>
        {!configured ? (
          <div className="vision-configure">
            <FileText size={17} />
            <p>
              {t(
                "图像分析未配置；当前继续使用文本研读。可另外连接支持图像的模型。",
                "Image analysis is not configured. Text reading remains available; you can connect a separate image-capable model.",
              )}
            </p>
            <button type="button" className="soft-button" onClick={onConfigure}>
              <Settings2 size={14} />
              {t("配置视觉模型", "Configure vision")}
            </button>
          </div>
        ) : (
          <p className="vision-model-label">
            <Image size={14} />
            {profile?.name} · <strong>{visionModel}</strong>
            <button type="button" onClick={onConfigure}>
              {t("更改", "Change")}
            </button>
          </p>
        )}
        {figures.length && source ? (
          <div className="vision-request">
            <label htmlFor={`vision-figure-${paper.id}`}>
              {t("选择已有图表裁切", "Choose a source figure crop")}
            </label>
            <select
              id={`vision-figure-${paper.id}`}
              value={selected?.id || ""}
              title={selected?.id}
              disabled={busy}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setError("");
              }}
            >
              {figures.map((figure) => (
                <option key={figure.id} value={figure.id}>
                  {sourceFigureLabel(figure, language)}
                </option>
              ))}
            </select>
            {selected && expanded && (
              <div className="vision-crop-preview">
                <RecoverableFeature key={source} feature="figure" onExit={onPage ? () => onPage(selected.page) : undefined}>
                <Suspense fallback={<p>{t("正在加载原文图表…", "Loading source figure…")}</p>}>
                  <PdfFigure
                    url={source}
                    page={selected.page}
                    crop={selected.crop}
                    caption={selected.caption}
                    captionIsOriginal
                    onOpenPage={onPage}
                  />
                </Suspense>
                </RecoverableFeature>
              </div>
            )}
            <label htmlFor={`vision-focus-${paper.id}`}>
              {t("图像分析侧重点（可选）", "Image analysis focus (optional)")}
            </label>
            <textarea
              id={`vision-focus-${paper.id}`}
              rows={2}
              maxLength={3000}
              value={focus}
              disabled={busy}
              onChange={(event) => setFocus(event.target.value)}
              placeholder={t(
                "例如：逐项解释图例与坐标轴，区分图中可见结论和正文推断。",
                "For example: explain the legend and axes; separate visible evidence from claims in the text.",
              )}
            />
            <div className="vision-submit">
              <span>
                {t(
                  "仅发送选中裁切图及相关文字。新分析默认不参与后续解读和问答。",
                  "Sends only this crop and related text. New analyses are not used in future readings or questions until you include them.",
                )}
              </span>
              <button
                type="button"
                className="soft-button"
                disabled={!configured || busy}
                onClick={() => void analyze()}
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Sparkles size={15} />
                )}
                {busy
                  ? stage === "crop"
                    ? t("正在裁切…", "Rendering crop…")
                    : t("正在分析…", "Analyzing…")
                  : t("分析这张图", "Analyze this figure")}
              </button>
            </div>
          </div>
        ) : (
          <p className="vision-empty">
            {t(
              "尚无可发送的图表裁切。可在「管理图表裁切」中从原 PDF 框选并核对图表，也可用论文 skill 保存裁切。整页预览不会作为图表发送。",
              "No source figure crops are available. Use Manage figure crops to select and review regions from the source PDF, or save them with the paper skill. Full-page previews are not sent as figures.",
            )}
          </p>
        )}
        {error && (
          <p className="vision-error" role="alert">
            {error}
          </p>
        )}
        {!!evidence.length && (
          <div className="vision-results">
            {evidence.map((item, index) => {
              const historical = latestByFigure.get(item.figureId) !== item.id;
              const eligible = !historical && !item.stale && !item.excluded;
              const currentFigure = figures.find(figure => figure.id === item.figureId);
              const figureLabel = sourceFigureLabel({page:item.page, label:item.stale ? undefined : currentFigure?.label, caption:item.caption || (item.stale ? undefined : currentFigure?.caption)}, language);
              const createdAt = new Date(item.createdAt);
              const timestamp = Number.isNaN(createdAt.getTime()) ? t("时间未知", "Time unknown") : createdAt.toLocaleString(english ? "en" : "zh-CN", {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
              return (
              <details key={item.id} className="vision-result" data-evidence-id={item.id}
                ref={element => { if (element) resultRefs.current.set(item.id, element); else resultRefs.current.delete(item.id); }}
                onToggle={event => { const open = event.currentTarget.open; setOpenResults(previous => { const next = new Set(previous); if (open) next.add(item.id); else next.delete(item.id); return next; }); }}>
                <summary>
                  <span className="vision-result-heading">
                    {figureLabel}
                    <small className={`vision-use-badge ${eligible ? 'is-included' : ''}`}>{historical ? t("历史", "Historical") : item.stale ? t("来源已变化", "Source changed") : eligible ? t("已纳入 · 未核验", "Included · Unverified") : t("未纳入", "Not included")}</small>
                  </span>
                  <span className="vision-result-time">
                    <span>{t("记录", "Record")} {evidence.length - index} · {item.language.startsWith("en") ? "English" : "中文"}</span>
                    <time dateTime={Number.isNaN(createdAt.getTime()) ? undefined : item.createdAt}>{timestamp}</time>
                  </span>
                </summary>
                <div className="vision-result-content">
                  <div className="vision-result-meta">
                    <button type="button" onClick={() => onPage(item.page)}>
                      p.{item.page}
                    </button>
                    <span>{item.source.model}</span>
                    <span>
                      {item.width} × {item.height}
                    </span>
                  </div>
                  {item.stale && (
                    <p className="vision-stale" role="status">
                      {t(
                        "原 PDF 或图表裁切已更新，此分析对应旧来源。请重新分析当前图像。",
                        "The source PDF or crop has changed. This analysis describes an earlier source; analyze the current image again.",
                      )}
                    </p>
                  )}
                  <p className="vision-result-status">
                    {t(
                      "模型图像解读 · 未经独立核验",
                      "Model image analysis · Not independently verified",
                    )}
                  </p>
                  {item.focus && (
                    <p className="vision-result-focus">
                      {t("侧重点：", "Focus: ")}
                      {item.focus}
                    </p>
                  )}
                  <div className="vision-markdown">
                    <Mark onPage={onPage}>{item.markdown}</Mark>
                  </div>
                  <p className="vision-use-status" role="status">{historical
                    ? t("已有更新分析，这条记录仅供历史查阅。", "A newer analysis exists. This record is kept for reference only.")
                    : item.stale ? t("来源已变化，不参与后续解读和问答。", "Source changed; not used in future readings or questions.")
                    : item.excluded ? t("尚未纳入后续解读和问答。可对照原图后主动纳入，或继续只在此阅读。", "Not included in future readings or questions. Compare with the source, then include it if useful, or keep it here for reference.")
                    : t("将用于后续解读和问答，仍未经独立核验。已生成版本不会被改写。", "Included in future readings and questions, still unverified. Existing versions remain unchanged.")}</p>
                  {!historical && !item.stale && <button type="button" className="text-button" disabled={!!changingEvidence} onClick={()=>void toggleEvidence(item)}>{item.excluded ? t("纳入后续解读和问答", "Use in future readings") : t("不用于后续解读和问答", "Exclude from future readings")}</button>}
                  {!item.stale && source && openResults.has(item.id) && <details className="vision-source-comparison">
                    <summary>{t("对照原图与图注", "Compare source figure and caption")}</summary>
                    <RecoverableFeature key={source} feature="figure" onExit={onPage ? () => onPage(item.page) : undefined}>
                    <Suspense fallback={<p>{t("正在加载原文图表…", "Loading source figure…")}</p>}>
                      <PdfFigure url={source} page={item.page} crop={item.crop} caption={item.caption || figures.find(figure => figure.id === item.figureId)?.caption} captionIsOriginal onOpenPage={onPage}/>
                    </Suspense>
                    </RecoverableFeature>
                  </details>}
                  <details className="vision-limitations">
                    <summary>
                      {t("来源与限制", "Provenance and limitations")}
                    </summary>
                    <p>
                      {t(
                        "来源：浏览器根据 PDF 页码与图表坐标渲染的裁切；服务端记录图像摘要，不保存上传图像。",
                        "Source: a browser-rendered PDF crop at the recorded page and coordinates. The server records an image hash, not the uploaded image.",
                      )}
                    </p>
                    <p className="vision-source-id">{t("图表 ID：", "Source figure ID: ")}<code>{item.figureId}</code></p>
                    {item.limitations?.length ? (
                      <ul>
                        {item.limitations.map((limit, index) => (
                          <li key={index}>{systemLimitations.has(limit)
                            ? english ? limit : systemLimitations.get(limit)
                            : <><span className="vision-original-limitation">{t("原文说明：", "Original note: ")}</span>{limit}</>}</li>
                        ))}
                      </ul>
                    ) : null}
                    <code title={item.imageHash}>
                      {item.imageHash.slice(0, 24)}…
                    </code>
                  </details>
                </div>
              </details>
            );})}
          </div>
        )}
      </div>
    </details>
  );
}
