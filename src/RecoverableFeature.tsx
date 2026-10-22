import { Component, useEffect, useRef, type ReactNode } from "react";
import { useLocale } from "./i18n";
import "./recoverable-feature.css";

type Props = {
  children: ReactNode;
  feature: "reader" | "figure" | "figure-manager";
  onExit?: () => void;
  onBeforeReload?: () => void;
};

function UnavailableFeature({ feature, onExit, onBeforeReload }: Props) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDivElement>(null), exit = useRef(onExit);
  exit.current = onExit;
  useEffect(() => {
    if (feature !== "figure-manager") return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); exit.current?.(); }
      if (event.key === "Tab") {
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>("button");
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (!dialog.current?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("keydown", keyboard, true); if (previous?.isConnected) previous.focus(); };
  }, [feature]);
  const title = feature === "reader" ? t("论文阅读器暂时无法显示", "The PDF reader is unavailable")
    : feature === "figure-manager" ? t("图表编辑器暂时无法显示", "The figure editor is unavailable")
    : t("原文图表暂时无法显示", "The source figure is unavailable");
  const content = <section className="feature-unavailable" role="alert">
    <h3>{title}</h3>
    <p>{t("组件加载或显示失败。可以继续使用其他功能，或刷新页面重新加载。", "This component could not load or display. You can keep using the rest of the workspace, or reload the page to try again.")}</p>
    <div className="feature-recovery-actions">
      <button className="soft-button" onClick={() => { onBeforeReload?.(); window.location.reload(); }}>{t("刷新页面重试", "Reload page to retry")}</button>
      {onExit && <button className="soft-button" onClick={onExit}>{feature === "reader" ? t("返回摘要", "Back to overview") : feature === "figure" ? t("查看原文页", "View source page") : t("关闭", "Close")}</button>}
    </div>
  </section>;
  return feature === "figure-manager" ? <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onExit?.(); }}>
    <div ref={dialog} className="modal feature-recovery-modal" role="dialog" aria-modal="true" aria-label={title}>{content}</div>
  </div> : content;
}

/** Keep a failed optional module from unmounting the reading workspace.
 * React.lazy and the browser cache rejected imports: recovery deliberately
 * reloads the document, rather than remounting the same rejected promise. */
export default class RecoverableFeature extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <UnavailableFeature {...this.props} /> : this.props.children; }
}
