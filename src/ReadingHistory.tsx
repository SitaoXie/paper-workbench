import { useState } from "react";
import { Clock3, MessageSquare, Languages, Sparkles, X } from "lucide-react";
import type { Activity, Conversation, Paper } from "./types";
import { readingVersions } from "./ReadingOverview";
import Mark from "./Markdown";
import { useLocale } from "./i18n";
import "./locale-polish.css";
export default function ReadingHistory({
  paper,
  conversations,
  activities,
  busy,
  onClose,
  onConversation,
  onVersion,
  onPage,
  onOverview,
  onSaveActivity,
}: {
  paper?: Paper | null;
  conversations: Conversation[];
  activities: Activity[];
  busy: boolean;
  onClose: () => void;
  onConversation: (id: string) => void;
  onVersion: (id: string) => void;
  onPage: (page: number) => void;
  onOverview: () => void;
  onSaveActivity?: (activity: Activity) => Promise<void>;
}) {
  const { locale, t } = useLocale();
  const date = (value: string) => new Date(value).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "short", day: "numeric" });
  const [tab, setTab] = useState("questions"),
    [opened, setOpened] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState<string[]>([]),
    [error, setError] = useState("");
  const versions = paper ? readingVersions(paper) : [];
  const sourceLabel = (activity: Activity) => activity.sourceScope === "reading"
    ? t("解读选文", "Overview selection")
    : activity.sourceScope === "abstract" ? t("原始摘要", "Original abstract")
    : activity.page ? `p.${activity.page}` : t("原文选文", "Source text");
  const returnToSource = (activity: Activity) => {
    if (activity.sourceScope === "reading" && activity.readingId) onVersion(activity.readingId);
    else if (activity.sourceScope === "abstract" || !activity.page) onOverview();
    else onPage(activity.page);
  };
  const entries = activities.filter((a) =>
    tab === "translations"
      ? a.kind === "translation"
      : a.kind === "explanation",
  );
  return (
    <section
      className="reading-history"
      aria-label={t("阅读历史", "Reading history")}
    >
      <header>
        <strong>
          <Clock3 size={16} />
          {t("阅读历史", "Reading history")}
        </strong>
        <button
          className="icon-button"
          aria-label={t("关闭对话历史", "Close conversation history")}
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      <div className="history-tabs" role="tablist" aria-label={t("历史分类", "History categories")}>
        {[
          ["questions", t("问答", "Questions")],
          ["translations", t("翻译", "Translations")],
          ["explanations", t("解释", "Explanations")],
          ["versions", t("解读版本", "Versions")],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setOpened(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="history-content">
        {tab === "questions"
          ? conversations
              .filter((c) => c.messageCount > 0)
              .map((c) => (
                <button
                  key={c.id}
                  className="history-entry"
                  disabled={busy}
                  onClick={() => onConversation(c.id)}
                >
                  <MessageSquare size={14} />
                  <span>{c.title}</span>
                  <small>{c.messageCount}</small>
                </button>
              ))
          : tab === "versions"
            ? versions.map((v) => (
                <button
                  className="history-entry"
                  key={v.id}
                  onClick={() => onVersion(v.id)}
                >
                  <Sparkles size={14} />
                  <span>
                    {v.title ||
                      {
                        quick: t("快速了解", "Quick read"),
                        deep: t("深入研读", "Deep read"),
                        critical: t("批判性阅读", "Critical read"),
                      }[v.style] ||
                      v.style}{" "}
                    · {v.language}
                    <small>{v.focus}</small>
                  </span>
                  <small>{date(v.createdAt)}</small>
                </button>
              ))
            : entries.map((a) => (
                <div className="history-activity" key={a.id}>
                  <button
                    className="history-entry"
                    aria-expanded={opened === a.id}
                    onClick={() => setOpened(opened === a.id ? null : a.id)}
                  >
                    {a.kind === "translation" ? <Languages size={14} /> : <Sparkles size={14} />}
                    <span>
                      {a.quote || a.text}
                      <small>
                        {sourceLabel(a)} · {a.language} ·{" "}
                        {date(a.createdAt)}
                      </small>
                    </span>
                  </button>
                  {opened === a.id && (
                    <div className="history-activity-detail">
                      <blockquote>{a.quote || a.text}</blockquote>
                      <div className="prose">
                        <Mark onPage={onPage}>
                          {typeof a.result === "string"
                            ? a.result
                            : a.result?.text || ""}
                        </Mark>
                      </div>
                      <div className="history-detail-actions">
                        <button
                          className="text-button"
                          onClick={() => returnToSource(a)}
                        >
                          {t("回到原文", "Back to source")} · {sourceLabel(a)}
                        </button>
                        {onSaveActivity && !!a.page && (!a.sourceScope || a.sourceScope === "pdf") && (
                          <button
                            className="text-button"
                            disabled={saving || saved.includes(a.id)}
                            onClick={async () => {
                              setSaving(true);
                              setError("");
                              try {
                                await onSaveActivity(a);
                                setSaved((old) => [...old, a.id]);
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setSaving(false);
                              }
                            }}
                          >
                            {saved.includes(a.id)
                              ? t("已保存到笔记", "Saved to notes")
                              : t("保存到笔记", "Save to notes")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
        {((tab === "questions" &&
          !conversations.some((c) => c.messageCount > 0)) ||
          (tab === "versions" && !versions.length) ||
          (["translations", "explanations"].includes(tab) &&
            !entries.length)) && (
          <p className="history-empty">
            {t("此分类暂无记录。", "No entries in this category yet.")}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
