import { useState } from "react";
import {
  Check,
  ChevronDown,
  Globe2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api, type Settings, type ModelProfile } from "./types";

type Draft = ModelProfile & {
  apiKey?: string;
  clearApiKey?: boolean;
  extra: string;
  modelText: string;
};
function toDraft(s: ModelProfile): Draft {
  return {
    ...s,
    extra: JSON.stringify(s.extraBody || {}, null, 2),
    modelText: (s.models?.length ? s.models : [s.model]).join("\n"),
  };
}
export function profileList(s: Settings): ModelProfile[] {
  return s.profiles?.length
    ? s.profiles
    : [
        {
          ...s,
          id: "default",
          name: "默认连接",
          models: s.model ? [s.model] : [],
        },
      ];
}
export default function SettingsDialog({
  current,
  onClose,
  onSaved,
}: {
  current: Settings;
  onClose: () => void;
  onSaved: (s: Settings) => void;
}) {
  const [profiles, setProfiles] = useState(() =>
    profileList(current).map(toDraft),
  );
  const [selected, setSelected] = useState(
    current.activeProfileId || profileList(current)[0].id,
  );
  const [active, setActive] = useState(
    current.activeProfileId || profileList(current)[0].id,
  );
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const draft = profiles.find((p) => p.id === selected) || profiles[0];
  const update = (patch: Partial<Draft>) =>
    setProfiles((ps) =>
      ps.map((p) => {
        if (p.id !== draft.id) return p;
        const origin = (url: string) => {
          try {
            return new URL(url).origin;
          } catch {
            return "";
          }
        };
        const destinationChanged =
          (patch.provider !== undefined && patch.provider !== p.provider) ||
          (patch.baseUrl !== undefined &&
            origin(patch.baseUrl) !== origin(p.baseUrl));
        return {
          ...p,
          ...patch,
          ...(destinationChanged
            ? {
                apiKey: "",
                apiKeyConfigured: false,
                modelConfigured: false,
                clearApiKey: true,
              }
            : {}),
        };
      }),
    );
  const payload = () => ({
    activeProfileId: active,
    profiles: profiles.map(({ extra, modelText, ...p }) => {
      const models = [
        ...new Set(
          modelText
            .split(/[\n,，]+/)
            .map((m) => m.trim())
            .filter(Boolean),
        ),
      ];
      if (!models.includes(p.model.trim())) models.unshift(p.model.trim());
      return {
        ...p,
        model: p.model.trim(),
        models: models.filter(Boolean),
        extraBody: JSON.parse(extra),
      };
    }),
  });
  async function run(action: "save" | "test") {
    setBusy(action);
    setFeedback("");
    try {
      const body = payload();
      if (action === "save") {
        const s = await api<Settings>("/settings", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        onSaved(s);
        setProfiles(profileList(s).map(toDraft));
        setActive(s.activeProfileId || active);
        setFeedback("配置已保存");
      } else {
        await api("/settings/test", {
          method: "POST",
          body: JSON.stringify({ ...body, activeProfileId: selected }),
        });
        setFeedback("连接成功，模型已响应。");
      }
      setFailed(false);
    } catch (e) {
      setFeedback((e as Error).message);
      setFailed(true);
    } finally {
      setBusy("");
    }
  }
  function add() {
    const id = crypto.randomUUID();
    setProfiles((ps) => [
      ...ps,
      toDraft({
        id,
        name: `连接 ${ps.length + 1}`,
        provider: "openai",
        baseUrl: "https://api.example.com/v1",
        model: "",
        models: [],
        apiKeyConfigured: false,
      }),
    ]);
    setSelected(id);
    setFeedback("");
  }
  function remove() {
    const remaining = profiles.filter((p) => p.id !== draft.id);
    if (!remaining.length) return;
    setProfiles(remaining);
    setSelected(remaining[0].id);
    if (active === draft.id) setActive(remaining[0].id);
  }
  return (
    <div
      className="modal-backdrop settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">YOUR MODELS, YOUR WORKSPACE</span>
            <h2 id="settings-title">模型与 API</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭模型设置"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="settings-intro">
          每个连接保存一组 API 和多个模型。
          <br />
          摘要、翻译和问答都可以自由切换模型。
        </p>
        <div className="profile-list" aria-label="已保存的模型连接">
          {profiles.map((p) => (
            <button
              key={p.id}
              className={p.id === draft.id ? "selected" : ""}
              onClick={() => {
                setSelected(p.id);
                setFeedback("");
              }}
            >
              <span>{p.name || "未命名连接"}</span>
              <small>
                {p.modelText.split(/[\n,，]+/).filter(Boolean).length} 个模型
                {active === p.id ? " · 当前使用" : ""}
              </small>
            </button>
          ))}
          <button className="add-profile" onClick={add}>
            <Plus size={15} /> 添加连接
          </button>
        </div>
        <label htmlFor="profile-name">连接名称</label>
        <input
          id="profile-name"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="例如：个人 API / 本地模型"
        />
        <label htmlFor="provider">API 协议</label>
        <select
          id="provider"
          value={draft.provider}
          onChange={(e) =>
            update({
              provider: e.target.value,
              baseUrl:
                e.target.value === "anthropic"
                  ? "https://api.anthropic.com"
                  : "https://api.openai.com/v1",
              extra: "{}",
            })
          }
        >
          <option value="openai">OpenAI 兼容</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <label htmlFor="base-url">API Base URL</label>
        <input
          id="base-url"
          value={draft.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
        <label htmlFor="models-list">预填模型列表</label>
        <textarea
          id="models-list"
          className="models-list"
          rows={4}
          value={draft.modelText}
          onChange={(e) => update({ modelText: e.target.value })}
          placeholder={
            "每行一个模型 ID，例如：\nmodel-fast\nmodel-reasoning\nmodel-vision"
          }
        />
        <p className="field-hint">
          同一 URL 与 API Key 共用；每行或逗号分隔一个模型 ID。
        </p>
        <label htmlFor="model">模型名称</label>
        <input
          id="model"
          list="configured-models"
          value={draft.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder="当前使用的模型 ID"
        />
        <datalist id="configured-models">
          {draft.modelText
            .split(/[\n,，]+/)
            .filter(Boolean)
            .map((m) => (
              <option key={m.trim()} value={m.trim()} />
            ))}
        </datalist>
        <label htmlFor="api-key">
          API Key{" "}
          {draft.apiKeyConfigured && !draft.clearApiKey && (
            <span className="configured">
              <Check size={12} /> 已配置
            </span>
          )}
        </label>
        <input
          id="api-key"
          type="password"
          autoComplete="new-password"
          value={draft.apiKey || ""}
          onChange={(e) =>
            update({ apiKey: e.target.value, clearApiKey: false })
          }
          placeholder={
            draft.apiKeyConfigured ? "已保存 · 留空以保留" : "本地服务可留空"
          }
        />
        {draft.apiKeyConfigured && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.clearApiKey || false}
              onChange={(e) => update({ clearApiKey: e.target.checked })}
            />
            清除已保存的 API Key
          </label>
        )}
        <div className="profile-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={active === draft.id}
              onChange={() => setActive(draft.id)}
            />
            将此连接设为当前使用
          </label>
          <button
            className="text-button danger"
            disabled={profiles.length < 2}
            onClick={remove}
          >
            <Trash2 size={13} /> 删除连接
          </button>
        </div>
        <details className="advanced-settings">
          <summary>
            高级请求参数 <ChevronDown size={12} />
          </summary>
          <label htmlFor="context-budget">论文上下文预算（字符）</label>
          <input
            id="context-budget"
            type="number"
            min="8000"
            max="300000"
            step="1000"
            value={draft.contextChars || 44000}
            onChange={(e) => update({ contextChars: Number(e.target.value) })}
          />
          <label htmlFor="max-output">模型输出上限（Tokens）</label>
          <input
            id="max-output"
            type="number"
            min="512"
            max="16384"
            step="512"
            value={draft.maxOutputTokens || 4096}
            onChange={(e) =>
              update({ maxOutputTokens: Number(e.target.value) })
            }
          />
          <label htmlFor="extra-body">额外 JSON 参数</label>
          <textarea
            id="extra-body"
            spellCheck={false}
            value={draft.extra}
            onChange={(e) => update({ extra: e.target.value })}
          />
        </details>
        <div className="settings-privacy">
          <ShieldCheck size={17} />
          <p>
            密钥仅保存在本机服务端。配置和论文不随源码分享；只有主动生成或提问时才向所选服务发送内容。
          </p>
        </div>
        {feedback && (
          <div className={failed ? "form-error" : "form-success"} role="status">
            {feedback}
          </div>
        )}
        <div className="settings-actions">
          <button
            className="soft-button"
            disabled={!!busy || !draft.model || !draft.baseUrl}
            onClick={() => run("test")}
          >
            {busy === "test" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Globe2 size={15} />
            )}
            测试连接
          </button>
          <button
            className="primary-button"
            disabled={!!busy}
            onClick={() => run("save")}
          >
            {busy === "save" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            保存配置
          </button>
        </div>
        <div className="settings-footer">
          也可以使用已登录的 Codex / Claude 会话和项目 skill
          <br />
          直接写入解读，无需配置额外 API。
        </div>
      </section>
    </div>
  );
}
