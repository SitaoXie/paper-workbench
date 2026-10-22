import { useEffect, useState } from "react";
import { Clock3, MessageSquare, Languages, Sparkles, X } from "lucide-react";
import type { Activity, Conversation, Paper } from "./types";
import { readingVersions } from "./ReadingOverview";
import Mark from "./Markdown";
import { activityResultText, usableActivityResult } from "./activity-result";
import { useLocale } from "./i18n";
import { pageLabel } from "./page-label";
import "./locale-polish.css";

function historyView(paperId: string) {
  try {
    const raw = sessionStorage.getItem(`pw-history-view:${paperId}`);
    if (!raw || raw.length > 1000) return;
    const value = JSON.parse(raw);
    if (['questions', 'translations', 'explanations', 'versions'].includes(value?.tab) &&
      (value.opened === null || (typeof value.opened === 'string' && value.opened.length < 256))) return value as {tab:string;opened:string|null};
  } catch { /* History remains usable when browser storage is unavailable. */ }
}
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
  onPage: (page: number, quote?: string) => void;
  onOverview: (activity?:Activity) => void;
  onSaveActivity?: (activity: Activity) => Promise<void>;
}) {
  const { locale, t } = useLocale();
  const date = (value: string) => new Date(value).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "short", day: "numeric" });
  const context = paper?.id || 'research';
  const [tab, setTab] = useState(() => historyView(context)?.tab || "questions"),
    [opened, setOpened] = useState<string | null>(() => historyView(context)?.opened || null),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState<string[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    try { sessionStorage.setItem(`pw-history-view:${context}`, JSON.stringify({tab,opened})); }
    catch { /* Only view state is cached; activities stay on the local server. */ }
  }, [context, tab, opened]);
  const versions = paper ? readingVersions(paper) : [];
  const sourceLabel = (activity: Activity) => activity.sourceScope === "reading"
    ? t("解读选文", "Overview selection")
    : activity.sourceScope === "abstract" ? (paper?.abstractIsExcerpt ? t("首页摘录", "Opening excerpt") : t("原始摘要", "Original abstract"))
    : activity.page ? pageLabel(activity.page,activity.pages) : t("原文选文", "Source text");
  const returnToSource = (activity: Activity) => {
    if (activity.sourceScope === "reading" && activity.readingId) onVersion(activity.readingId);
    else if (activity.sourceScope === "abstract" || !activity.page) onOverview(activity);
    else { const quote=activity.quote || activity.text; onPage(activity.page, (activity.pages?.length || 0)<=1 && quote && quote.length<=500 ? quote : undefined); }
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
              .filter((c) => c.messageCount > 0 || c.draft)
              .map((c) => (
                <button
                  key={c.id}
                  className="history-entry"
                  disabled={busy}
                  onClick={() => onConversation(c.id)}
                >
                  <MessageSquare size={14} />
                  <span>{c.title}{c.source?.kind === "branch" && <small>{t("分支对话", "Branched conversation")}</small>}</span>
                  <small>{c.draft ? t("草稿", "Draft") : c.messageCount}</small>
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
                      {usableActivityResult(a.result) ? <div className="prose">
                        <Mark onPage={onPage}>{activityResultText(a.result)}</Mark>
                      </div> : <div className="history-invalid-result" role="status">
                        <p>{t("这条历史记录没有有效的翻译或解释结果，不能保存为笔记。请回到原文重新选择周围的句子。", "This older entry has no usable translation or explanation to save. Return to the source and select the surrounding sentence again.")}</p>
                        <details><summary>{t("查看原始记录", "View original record")}</summary><pre>{activityResultText(a.result) || t("空结果", "Empty result")}</pre></details>
                      </div>}
                      <div className="history-detail-actions">
                        {(a.pages?.length || 0) > 1 && a.pages!.map(page => <button className="text-button" key={page} onClick={()=>onPage(page)}>{t('源页','Source page')} · p.{page}</button>)}
                        <button
                          className="text-button"
                          onClick={() => returnToSource(a)}
                        >
                          {t("回到原文", "Back to source")} · {sourceLabel(a)}
                        </button>
                        {onSaveActivity && !!a.page && (a.pages?.length || 0) <= 1 && (!a.sourceScope || a.sourceScope === "pdf") && (
                          <button
                            className="text-button"
                            disabled={saving || saved.includes(a.id) || !usableActivityResult(a.result)}
                            onClick={async () => {
                              if (!usableActivityResult(a.result)) return;
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
                      {(a.pages?.length || 0) > 1 && <p className="muted">{t('跨页结果已保留在历史中。需要带原文定位的笔记时，请在 PDF 选文结果中保存。','This multi-page result is saved in history. To attach precise source anchors, save it from the PDF selection result.')}</p>}
                    </div>
                  )}
                </div>
              ))}
        {((tab === "questions" &&
          !conversations.some((c) => c.messageCount > 0 || c.draft)) ||
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
