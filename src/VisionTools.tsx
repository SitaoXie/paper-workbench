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
import "./vision-tools.css";
const PdfFigure = lazy(() => import("./PdfFigure"));

type Props = {
  paper: Paper;
  settings: Settings;
  onUpdated: (paper: Paper) => void;
  onConfigure: () => void;
  onPage: (page: number) => void;
  language: string;
};

/** Vision is opt-in, independently configured, and never presented as ground truth. */
export default function VisionTools({
  paper,
  settings,
  onUpdated,
  onConfigure,
  onPage,
  language,
}: Props) {
  const english = language.startsWith("en");
  const t = (zh: string, en: string) => (english ? en : zh);
  const figures = (paper.figures || []).filter((figure) => figure.crop);
  const [selectedId, setSelectedId] = useState(figures[0]?.id || "");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [changingEvidence, setChangingEvidence] = useState("");
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
  const evidence = [...(paper.visualEvidence || [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  useEffect(() => {
    request.current += 1;
    controller.current?.abort();
    setBusy(false);
    setExpanded(false);
    setError("");
    setFocus("");
    setSelectedId("");
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
      if (request.current === revision) onUpdated(response.paper);
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
    <details className="vision-tools" key={paper.id} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <span>
          <Eye size={16} />
          {t("图像证据", "Image evidence")}
          {!!evidence.length && <small>{evidence.length}</small>}
        </span>
        <span className="vision-summary-state">
          {evidence.length
            ? t("已收到图像 · 未独立核验", "Images received · Unverified")
            : t("尚无图像输入记录", "No image input recorded")}
        </span>
      </summary>
      <div className="vision-tools-body">
        <p className="vision-evidence-boundary">
          {evidence.length
            ? t(
                "图像已交给所选模型；模型的解释仍可能出错，不等于独立核验。视觉分析单独保存，不会改写当前解读。",
                "The selected model received image pixels. Its interpretation may be wrong and is not independent verification. Image analyses are saved separately from the reading.",
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
              disabled={busy}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setError("");
              }}
            >
              {figures.map((figure) => (
                <option key={figure.id} value={figure.id}>
                  {figure.id} · p.{figure.page} · {figure.caption}
                </option>
              ))}
            </select>
            {selected && expanded && (
              <div className="vision-crop-preview">
                <Suspense fallback={<p>{t("正在加载原文图表…", "Loading source figure…")}</p>}>
                  <PdfFigure
                    url={source}
                    page={selected.page}
                    crop={selected.crop}
                    caption={selected.caption}
                    onOpenPage={onPage}
                  />
                </Suspense>
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
                  "仅发送选中裁切图及相关文字；不会自动调用模型。",
                  "Only the selected crop and related text are sent. No automatic model calls.",
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
              "尚无可发送的图表裁切。请先导入 PDF，并通过论文 skill 标记真实图表区域。整页预览不会冒充图表发送。",
              "No source figure crops are available. Import a PDF and identify actual figure regions with the paper skill first. Full-page previews are not sent as figures.",
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
            {evidence.map((item) => (
              <details key={item.id} className="vision-result">
                <summary>
                  <span>
                    {item.figureId} · {t("视觉分析", "Image analysis")}
                  </span>
                  <span>
                    {item.language.startsWith("en") ? "English" : "中文"} ·{" "}
                    {new Date(item.createdAt).toLocaleDateString(
                      english ? "en" : "zh-CN",
                    )}
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
                        "图表裁切已更新，此分析对应旧裁切。请重新分析当前图像。",
                        "The figure crop has changed. This analysis describes the previous crop; analyze the current image again.",
                      )}
                    </p>
                  )}
                  <p className="vision-result-status">
                    {t(
                      "模型已收到图像；模型结论未经独立核验。",
                      "The model received image pixels; its conclusions have not been independently verified.",
                    )}
                  </p>
                  {item.excluded && <p className="vision-stale" role="status">{t("已排除：后续解读不会使用这条模型观察。历史记录仍保留。", "Excluded from future readings. This observation remains in history.")}</p>}
                  <button className="text-button" disabled={!!changingEvidence} onClick={()=>void toggleEvidence(item)}>{item.excluded ? t("恢复用于后续解读", "Use in future readings") : t("不用于后续解读", "Exclude from future readings")}</button>
                  {item.focus && (
                    <p className="vision-result-focus">
                      {t("侧重点：", "Focus: ")}
                      {item.focus}
                    </p>
                  )}
                  <div className="vision-markdown">
                    <Mark onPage={onPage}>{item.markdown}</Mark>
                  </div>
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
                    {item.limitations?.length ? (
                      <ul>
                        {item.limitations.map((limit, index) => (
                          <li key={index}>{limit}</li>
                        ))}
                      </ul>
                    ) : null}
                    <code title={item.imageHash}>
                      {item.imageHash.slice(0, 24)}…
                    </code>
                  </details>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
