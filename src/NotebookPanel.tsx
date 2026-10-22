import { useEffect, useRef, useState } from "react";
import {
  BookMarked,
  Check,
  Download,
  Highlighter,
  Loader2,
  NotebookPen,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { annotationPageLabel, annotationSegments, type Annotation, type AnnotationDraft } from "./reader-annotations";
import Mark from "./Markdown";
import { t, getLocale } from "./i18n";
import { readNotebookView, writeNotebookView, readNoteDrafts } from "./notebook-state";

const labels: Record<string, () => string> = {
  highlight: () => t("高亮", "Highlights"),
  underline: () => t("下划线", "Underlines"),
  note: () => t("笔记", "Notes"),
  ink: () => t("手写", "Ink"),
  translation: () => t("翻译", "Translations"),
  explanation: () => t("解释", "Explanations"),
};
export default function NotebookPanel({
  paperId,
  annotations,
  selectedId,
  selectionNonce,
  page,
  loading,
  onClose,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onRestore,
}: {
  paperId: string;
  annotations: Annotation[];
  selectedId?: string;
  selectionNonce?: number;
  page: number;
  loading?: boolean;
  onClose: () => void;
  onSelect: (entry: Annotation, locate?: boolean, page?: number) => void;
  onCreate: (entry: AnnotationDraft) => Promise<Annotation | void>;
  onUpdate: (id: string, patch: Partial<Annotation>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRestore: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState(() => readNoteDrafts(paperId));
  const [savedView] = useState(() => readNotebookView(paperId));
  const [pendingSelection, setPendingSelection] = useState(selectedId ? undefined : savedView?.selectedId);
  const firstSelection = useRef(true), restoringSelection = useRef<string | undefined>(undefined);
  const [preview, setPreview] = useState(savedView?.preview || false);
  const [editing, setEditing] = useState(savedView?.editing || false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [deleted, setDeleted] = useState<string | undefined>(),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `pw-note-drafts:${paperId}`,
        JSON.stringify(drafts),
      );
    } catch {
      /* Editor remains usable if session storage is unavailable. */
    }
  }, [drafts, paperId]);
  useEffect(() => {
    if (firstSelection.current) {
      firstSelection.current = false;
      if (selectedId && (selectedId !== savedView?.selectedId || selectionNonce)) setEditing(true);
      return;
    }
    if (selectedId && restoringSelection.current !== selectedId) setEditing(true);
    restoringSelection.current = undefined;
  }, [selectedId, selectionNonce]);
  useEffect(() => {
    if (!pendingSelection || loading) return;
    if (selectedId) { setPendingSelection(undefined); return; }
    const entry = annotations.find(item=>item.id===pendingSelection);
    if (entry) {
      restoringSelection.current = entry.id;
      onSelect(entry, false);
      setPendingSelection(undefined);
    }
  }, [pendingSelection, selectedId, annotations, loading, onSelect]);
  useEffect(() => {
    if (!pendingSelection) writeNotebookView(paperId, {selectedId, editing, preview});
  }, [paperId, selectedId, editing, preview, pendingSelection]);
  const selected = annotations.find((a) => a.id === selectedId);
  const selectedSegments = selected ? annotationSegments(selected) : [];
  const draftKey = selected?.id || "new";
  const draft = drafts[draftKey] || {
    body: selected?.body || "",
    tags: selected?.tags?.join(", ") || "",
  };
  const items = annotations
    .filter(
      (a) =>
        (filter === "all" ||
          (filter === "note" && ["note", "translation", "explanation"].includes(a.kind)) ||
          (filter === "highlight" && a.kind === "underline") ||
          a.kind === filter) &&
        (!query ||
          `${annotationSegments(a).map(segment => segment.quote || "").join(" ")} ${a.body || ""} ${a.tags?.join(" ") || ""}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort((a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt));
  const setDraft = (patch: Partial<typeof draft>) => {
    setSaved(false);
    setDrafts((old) => ({ ...old, [draftKey]: { ...draft, ...patch } }));
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    await run(async () => {
      const body = draft.body.trim(),
        tags = draft.tags
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean)
          .slice(0, 20);
      if (selected) await onUpdate(selected.id, { body, tags });
      else {
        const created = await onCreate({
          kind: "note",
          page,
          body,
          tags,
          color: "yellow",
        });
        if (created) onSelect(created, false);
      }
      setDrafts((old) => {
        const next = { ...old };
        delete next[draftKey];
        return next;
      });
      setSaved(true);
    });
  }
  return (
    <aside
      className="notebook-panel"
      aria-label={t("论文笔记", "Paper notebook")}
    >
      <header className="notebook-header">
        <span>
          <NotebookPen size={18} />
          {t("笔记与批注", "Notes & annotations")}
          <small>{annotations.length}</small>
        </span>
        <button
          className="icon-button"
          aria-label={t("关闭笔记", "Close notebook")}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="notebook-actions">
        <button
          className="soft-button"
          onClick={() => {
            setPendingSelection(undefined);
            setEditing(true);
            if (selected) onSelect({ ...selected, id: "" });
          }}
        >
          <Plus size={15} />
          {t("新笔记", "New note")}
        </button>
        <a
          className="soft-button"
          href={`/api/papers/${paperId}/annotations/export?format=markdown`}
          download
        >
          <Download size={14} />
          {t("导出 Markdown", "Export Markdown")}
        </a>
        <a
          className="text-button"
          href={`/api/papers/${paperId}/annotations/export?format=json`}
          download
        >
          JSON
        </a>
      </div>
      <div className="notebook-search">
        <Search size={14} />
        <input
          aria-label={t("搜索笔记", "Search notes")}
          placeholder={t(
            "搜索摘录、笔记和标签…",
            "Search quotes, notes and tags…",
          )}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div
        className="notebook-filters"
        role="tablist"
        aria-label={t("批注分类", "Annotation categories")}
      >
        {[
          ["all", t("全部", "All")],
          ["highlight", t("高亮", "Highlights")],
          ["note", t("笔记", "Notes")],
          ["ink", t("手写", "Ink")],
        ].map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="reading-inline-error" role="alert">
          {error}
        </p>
      )}
      {deleted && (
        <div className="notebook-undo">
          {t("批注已移除。", "Annotation removed.")}
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onRestore(deleted);
                setDeleted(undefined);
              })
            }
          >
            <Undo2 size={13} />
            {t("撤销", "Undo")}
          </button>
        </div>
      )}
      <div className={`notebook-body ${editing ? "is-editing" : ""}`}>
        <div className="notebook-list">
          {loading ? (
            <p>
              <Loader2 className="spin" size={16} />
              {t("正在加载…", "Loading…")}
            </p>
          ) : items.length ? (
            items.map((item) => {
              const segments = annotationSegments(item);
              const quote = segments.map(segment => segment.quote || "").filter(Boolean).join("\n");
              return (
              <button
                key={item.id}
                className={`notebook-card ${item.id === selectedId ? "selected" : ""}`}
                data-color={item.color || "yellow"}
                onClick={() => {
                  setPendingSelection(undefined);
                  onSelect(item);
                  setEditing(true);
                  setSaved(false);
                }}
              >
                <span className="notebook-card-meta">
                  <span>
                    {item.kind === "highlight" ? (
                      <Highlighter size={12} />
                    ) : item.kind === "ink" ? (
                      <NotebookPen size={12} />
                    ) : (
                      <StickyNote size={12} />
                    )}{" "}
                    {labels[item.kind]?.() || item.kind}
                  </span>
                  <span className="notebook-page-label">
                    {annotationPageLabel(item)}
                    {segments.length > 1 && <span>{t(`${segments.length} 页`, `${segments.length} pages`)}</span>}
                  </span>
                </span>
                {quote && <blockquote>{quote}</blockquote>}
                <p>
                  {item.body ||
                    (item.kind === "ink"
                      ? t("手写笔迹", "Handwritten strokes")
                      : t("添加你的想法…", "Add your thoughts…"))}
                </p>
                {!!item.tags?.length && (
                  <small>{item.tags.map((tag) => `#${tag}`).join(" ")}</small>
                )}
              </button>
              );
            })
          ) : (
            <div className="notebook-empty">
              <BookMarked size={30} />
              <h3>
                {query
                  ? t("没有匹配的笔记", "No matching notes")
                  : t("让阅读留下线索", "Leave a trail as you read")}
              </h3>
              <p>
                {t(
                  "在论文中选中文字即可高亮、做笔记；也可写下整篇论文的想法。",
                  "Select text in the paper to highlight or annotate it, or add a note about the whole paper.",
                )}
              </p>
            </div>
          )}
        </div>
        {editing && !pendingSelection && (
          <div className="notebook-editor">
            <div className="notebook-editor-title">
              <strong>
                {selected ? labels[selected.kind]?.() : t("新笔记", "New note")}
              </strong>
              <button
                className="icon-button"
                aria-label={t("收起编辑器", "Close editor")}
                onClick={() => setEditing(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="notebook-editor-source">
              <button
                className="citation-link"
                onClick={() => {
                  if (selected) onSelect(selected);
                }}
              >
                {selected ? annotationPageLabel(selected) : `p.${page}`}
              </button>
              {selectedSegments.length > 1 && <span>{t(`${selectedSegments.length} 页 · 共用一条笔记`, `${selectedSegments.length} pages · one shared note`)}</span>}
              {selected && (
                <span>{new Date(selected.createdAt).toLocaleDateString(getLocale() === "zh" ? "zh-CN" : "en")}</span>
              )}
            </div>
            {selected && selectedSegments.map(segment => (
              <section className="notebook-source-segment" key={segment.page} aria-label={t(`第 ${segment.page} 页摘录`, `Excerpt from page ${segment.page}`)}>
                {selectedSegments.length > 1 && <button
                  className="citation-link"
                  onClick={() => onSelect(selected, true, segment.page)}
                  aria-label={t(`定位第 ${segment.page} 页摘录`, `Locate excerpt on page ${segment.page}`)}
                >p.{segment.page}</button>}
                {segment.quote ? <blockquote className="notebook-quote">{segment.quote}</blockquote> : selectedSegments.length > 1 && <p className="notebook-region-label">{t("已标注的页面区域", "Marked page region")}</p>}
              </section>
            ))}
            <div className="note-preview-toggle" role="group" aria-label={t("笔记显示方式", "Note display")}>
              <button aria-pressed={!preview} onClick={()=>setPreview(false)}>{t("编辑", "Edit")}</button>
              <button aria-pressed={preview} onClick={()=>setPreview(true)}>{t("预览", "Preview")}</button>
            </div>
            {preview ? <div className="prose notebook-preview"><Mark onPage={(number)=>selected && onSelect(selected, true, number)}>{draft.body || t("还没有笔记内容。", "No note content yet.")}</Mark></div> : <label>
              {t("你的笔记", "Your note")}
              <textarea
                aria-label={t("笔记内容", "Note content")}
                value={draft.body}
                rows={8}
                maxLength={20000}
                placeholder={t(
                  "记录理解、疑问或下一步行动。支持 Markdown。",
                  "Capture your understanding, questions, or next steps. Markdown is supported.",
                )}
                onChange={(e) => setDraft({ body: e.target.value })}
              />
            </label>}
            <label>
              {t("标签", "Tags")}
              <input
                aria-label={t("笔记标签", "Note tags")}
                value={draft.tags}
                placeholder={t(
                  "方法, 待核实, 复现",
                  "method, verify, reproduce",
                )}
                onChange={(e) => setDraft({ tags: e.target.value })}
              />
            </label>
            {selected &&
              (selected.kind === "highlight" ||
                selected.kind === "underline") && (
                <div
                  className="note-colors"
                  aria-label={t("高亮颜色", "Highlight color")}
                >
                  {["yellow", "green", "blue", "pink", "purple"].map(
                    (color) => (
                      <button
                        key={color}
                        data-color={color}
                        aria-label={color}
                        aria-pressed={selected.color === color}
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            onUpdate(selected.id, {
                              color: color as Annotation["color"],
                            }),
                          )
                        }
                      />
                    ),
                  )}
                </div>
              )}
            <div className="notebook-editor-actions">
              <button
                className="primary-button"
                disabled={busy || (!selected && !draft.body.trim())}
                onClick={() => void save()}
              >
                {busy ? (
                  <Loader2 size={14} className="spin" />
                ) : saved ? (
                  <Check size={14} />
                ) : (
                  <Check size={14} />
                )}{" "}
                {saved ? t("已保存", "Saved") : t("保存笔记", "Save note")}
              </button>
              {selected && (
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await onDelete(selected.id);
                      setDeleted(selected.id);
                      setEditing(false);
                    })
                  }
                >
                  <Trash2 size={14} />
                  {t("删除", "Delete")}
                </button>
              )}
            </div>
            <small className="muted-label">
              {t(
                "保存在本地；删除后可撤销。导出包含来源页码。",
                "Saved locally. Deletions can be undone; exports include source pages.",
              )}
            </small>
          </div>
        )}
      </div>
    </aside>
  );
}
