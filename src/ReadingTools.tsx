import { useRef, useState } from "react";
import { buildAgentReadingTask } from "./agent-task";
import { useLocale } from "./i18n";
import "./locale-polish.css";
import {
  Check,
  Code2,
  Copy,
  Languages,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { api, type Paper, type Settings } from "./types";
import { profileList } from "./SettingsDialog";
import { selectWorkspaceModel, useModelSelection } from "./model-selection";

export const languages = [
  ["zh-CN", "简体中文"],
  ["en", "English"],
];
export function ModelSelect({
  settings,
  onChange,
  disabled = false,
}: {
  settings: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const { pending: busy, error } = useModelSelection();
  const profiles = profileList(settings);
  async function select(value: string) {
    const [activeProfileId, model] = JSON.parse(value);
    await selectWorkspaceModel(activeProfileId, model, onChange);
  }
  return (
    <span className="model-select-wrap">
      <select
        aria-label={t("切换当前模型")}
        title={busy ? t("正在切换模型…", "Switching model…") : settings.model}
        aria-busy={busy}
        disabled={disabled || busy}
        value={JSON.stringify([
          settings.activeProfileId || profiles[0].id,
          settings.model,
        ])}
        onChange={(e) => select(e.target.value)}
      >
        {profiles.map((p) => (
          <optgroup key={p.id} label={p.name}>
            {[...new Set([...p.models, p.model])].filter(Boolean).map((m) => (
              <option key={m} value={JSON.stringify([p.id, m])}>
                {m}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {busy && <span className="model-switch-status" role="status"><Loader2 size={12} className="spin"/><span>{t("正在切换…", "Switching…")}</span></span>}
      {error && (
        <span className="model-select-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
export default function ReadingTools({
  paper,
  language,
  onLanguage,
  original,
  onOriginal,
  translating,
  onTranslate,
  onUpdated,
  onError,
  onSettings,
  modelReady,
  question,
  conversationId,
  onPrepareQuestionTask,
}: {
  paper: Paper;
  language: string;
  onLanguage: (v: string) => void;
  original: boolean;
  onOriginal: (v: boolean) => void;
  translating: boolean;
  onTranslate: (target: "abstract" | "summary" | "report") => void;
  onUpdated: (p: Paper) => void;
  onError: (v: string) => void;
  onSettings: () => void;
  modelReady: boolean;
  question?: string;
  conversationId?: string;
  onPrepareQuestionTask?: () => Promise<{ task: string; conversationId: string }>;
}) {
  const { t, locale, setLocale } = useLocale();
  const [showAgent, setShowAgent] = useState(false);
  const [copiedTask, setCopiedTask] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<{ key: string; conversationId: string; task: string } | null>(null);
  const taskKey = JSON.stringify([paper.id, question?.trim() || "", language, locale]);
  const currentTask = useRef({ key: taskKey, conversationId });
  currentTask.current = { key: taskKey, conversationId };
  const hasQuestion = Boolean(question?.trim());
  const preparedPrompt = prepared?.key === taskKey && prepared.conversationId === conversationId ? prepared.task : "";
  const prompt = hasQuestion ? preparedPrompt : buildAgentReadingTask({ origin: location.origin, paperId: paper.id, language, locale, abstractIsExcerpt: paper.abstractIsExcerpt, style: "quick", format: "article", focus: "" });
  const copied = Boolean(prompt) && copiedTask === prompt;
  async function copyPrompt() {
    const context = { key: taskKey, conversationId };
    setPreparing(true);
    setCopiedTask("");
    try {
      let task = prompt;
      if (hasQuestion) {
        if (!onPrepareQuestionTask) throw new Error(t("当前问答会话尚未准备好，请从助手中复制任务。", "The question session is not ready. Copy the task from the assistant."));
        const result = await onPrepareQuestionTask();
        if (currentTask.current.key !== context.key || (currentTask.current.conversationId && currentTask.current.conversationId !== result.conversationId)) return;
        task = result.task;
        setPrepared({ key: context.key, ...result });
      }
      try {
        await navigator.clipboard.writeText(task);
        if (currentTask.current.key === context.key) setCopiedTask(task);
      } catch {
        onError(t("无法访问剪贴板，请在文本框内复制任务。"));
      }
    } catch (e) {
      if (currentTask.current.key === context.key) onError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }
  async function refresh() {
    try {
      const r = await api<{ paper: Paper }>(`/papers/${paper.id}`);
      onUpdated(r.paper);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function importInsights(file?: File) {
    if (!file) return;
    setUploading(true);
    try {
      if (file.size > 256 * 1024) throw new Error(t("注入文件不能超过 256 KiB。"));
      const body = JSON.parse(await file.text());
      const r = await api<{ paper: Paper }>(`/papers/${paper.id}/insights`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      onUpdated(r.paper);
      setShowAgent(false);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <div className="reading-tools">
        <div className="reading-language">
          <Languages size={15} />
          <select
            aria-label={t("阅读语言")}
            value={language.startsWith("zh") ? "zh-CN" : "en"}
            onChange={(e) => {
              setLocale(e.target.value === "en" ? "en" : "zh");
              onLanguage(e.target.value);
              onOriginal(false);
            }}
          >
            {languages.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <button
          className={original ? "active text-button" : "text-button"}
          onClick={() => onOriginal(!original)}
          aria-pressed={original}
        >
          {original ? t("返回译文") : t("查看原文")}
        </button>
        <details className="translation-menu">
          <summary>
            {translating ? (
              <Loader2 className="spin" size={13} />
            ) : (
              <Languages size={13} />
            )}{" "}
            {t("翻译")}
          </summary>
          <div className="translation-actions">
            <span>{paper.abstractIsExcerpt ? t("首页摘录", "Opening excerpt") : t("原始摘要")}</span>
            <button
              className="text-button"
              disabled={translating}
              onClick={() => (modelReady ? onTranslate("abstract") : onSettings())}
            >
              {translating ? (
                <Loader2 className="spin" size={13} />
              ) : (
                <Languages size={13} />
              )}{" "}
              {translating ? t("正在翻译…") : t("翻译为所选语言")}
            </button>
            <span className="translation-note">{t("原文单独保留")}</span>
          </div>
        </details>
        <span className="action-spacer" />
        <button
          className="soft-button agent-entry"
          onClick={() => setShowAgent(!showAgent)}
          aria-expanded={showAgent}
        >
          <Code2 size={14} /> {t("用 Codex / Claude")}
        </button>
      </div>

      {showAgent && (
        <section className="agent-bridge" aria-label={t("订阅代理接入")}>
          <div className="section-heading">
            <h3>
              <Code2 size={16} /> {t("用你自己的订阅读论文")}
            </h3>
            <button
              className="icon-button"
              aria-label={t("关闭代理接入")}
              onClick={() => setShowAgent(false)}
            >
              <X size={16} />
            </button>
          </div>
          <p>
            {t("在已登录的 Codex 或 Claude Code 中打开这个项目，粘贴下面的任务。代理使用当前会话完成解读，再经通用 skill 写回此处。工作台会自动刷新。")}
          </p>
          {!hasQuestion && <small>{t("此入口默认生成速读图文版；需要精读、侧重点或辅助 skill 时，请在阅读解读的生成设置中复制任务。", "This entry creates a quick reading article. For a deep read, a specific focus or assistance skills, copy the task from the overview generation settings.")}</small>}
          <textarea aria-label={t("代理任务")} value={prompt} placeholder={t("点击复制任务后，将固定本次会话并显示可手动复制的任务。", "Copy the task to bind this conversation and display a manually copyable task.")} readOnly rows={6} />
          <div className="agent-bridge-actions">
            <button className="primary-button" onClick={copyPrompt} disabled={preparing}>
              {preparing ? <Loader2 size={14} className="spin" /> : copied ? <Check size={14} /> : <Copy size={14} />}{" "}
              {preparing ? t("准备任务…", "Preparing task…") : copied ? t("已复制任务") : t("复制代理任务")}
            </button>
            <button className="soft-button" onClick={refresh}>
              <RefreshCw size={14} /> {t("刷新结果")}
            </button>
            <label className="soft-button">
              <Upload size={14} />
              {uploading ? t("导入中…") : t("导入代理 JSON")}
              <input
                type="file"
                accept="application/json,.json"
                hidden
                disabled={uploading}
                onChange={(e) => {
                  void importInsights(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <a
            className="text-button"
            href="/api/agent-skill"
            download="SKILL.md"
          >
            {t("下载通用 Skill")}
          </a>
          <small>
            {t("使用你已登录的客户端会话；不会读取或复制订阅登录凭据。也支持任意能读写本地 HTTP API 的代理。")}
          </small>
        </section>
      )}
    </>
  );
}
