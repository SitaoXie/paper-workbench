import { useEffect, useRef, useState } from "react";
import { useModelSelection, writeWorkspaceSettings } from "./model-selection";
import { t, useLocale } from "./i18n";
import "./locale-polish.css";
import "./vision-tools.css";
import {
  Check,
  ChevronDown,
  Globe2,
  Eye,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  api,
  type Settings,
  type ModelProfile,
  type VisionSettings,
  type RecommendationSettings,
} from "./types";
import "./paper-recommendations.css";

type Draft = ModelProfile & {
  apiKey?: string;
  clearApiKey?: boolean;
  extra: string;
  modelText: string;
};
function modelCountLabel(modelText: string) {
  const count = modelText.split(/[\n,，]+/).filter(Boolean).length;
  return t(`${count} 个模型`, `${count} model${count === 1 ? "" : "s"}`);
}
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
          name: t("默认连接"),
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
  useLocale();
  const sharedWrite = useModelSelection();
  const openedDuringWrite = useRef(sharedWrite.pending);
  const [profiles, setProfiles] = useState(() =>
    profileList(current).map(toDraft),
  );
  const [selected, setSelected] = useState(
    current.activeProfileId || profileList(current)[0].id,
  );
  const [active, setActive] = useState(
    current.activeProfileId || profileList(current)[0].id,
  );
  const [vision, setVision] = useState<VisionSettings>(
    () => current.vision || { enabled: false },
  );
  const [recommendations, setRecommendations] = useState<RecommendationSettings>(() => current.recommendations || { enabled: false });
  const declaredModels = (profile: Draft) => [
    ...new Set(
      [...profile.modelText.split(/[\n,，]+/), profile.model]
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  ];
  const visionProfiles = profiles.filter((profile) =>
    declaredModels(profile).some(
      (model) => profile.modelCapabilities?.[model] === "vision",
    ),
  );
  const visionProfile = visionProfiles.find(
    (profile) => profile.id === vision.profileId,
  );
  const visionModels = visionProfile
    ? declaredModels(visionProfile).filter(
        (model) => visionProfile.modelCapabilities?.[model] === "vision",
      )
    : [];
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!openedDuringWrite.current || sharedWrite.pending || busy) return;
    // A selector can finish after this dialog opens. Its disabled, pristine form
    // must receive the confirmed settings before allowing a full-profile save.
    openedDuringWrite.current = false;
    setProfiles(profileList(current).map(toDraft));
    setActive(current.activeProfileId || profileList(current)[0].id);
    setSelected(current.activeProfileId || profileList(current)[0].id);
    setVision(current.vision || {enabled:false});
    setRecommendations(current.recommendations || { enabled: false });
  }, [current, sharedWrite.pending, busy]);
  const draft = profiles.find((p) => p.id === selected) || profiles[0];
  const update = (patch: Partial<Draft>) => {
    const origin = (url: string) => {
      try {
        return new URL(url).origin;
      } catch {
        return "";
      }
    };
    const destinationChanged =
      (patch.provider !== undefined && patch.provider !== draft.provider) ||
      (patch.baseUrl !== undefined &&
        origin(patch.baseUrl) !== origin(draft.baseUrl));
    if (destinationChanged && vision.profileId === draft.id)
      setVision((old) => ({ ...old, enabled: false }));
    if (destinationChanged && recommendations.profileId === draft.id)
      setRecommendations(old => ({ ...old, enabled: false }));
    setProfiles((ps) =>
      ps.map((profile) =>
        profile.id !== draft.id
          ? profile
          : {
              ...profile,
              ...patch,
              ...(destinationChanged
                ? {
                    apiKey: "",
                    apiKeyConfigured: false,
                    modelConfigured: false,
                    clearApiKey: true,
                    modelCapabilities: {},
                  }
                : {}),
            },
      ),
    );
  };
  const payload = () => ({
    activeProfileId: active,
    vision,
    recommendations,
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
        modelCapabilities: Object.fromEntries(
          models
            .filter(Boolean)
            .map((model) => [
              model,
              p.modelCapabilities?.[model] === "vision" ? "vision" : "text",
            ]),
        ),
        extraBody: JSON.parse(extra),
      };
    }),
  });
  async function run(action: "save" | "test") {
    if (busy || sharedWrite.pending) return;
    setBusy(action);
    setFeedback("");
    try {
      const body = payload();
      if (action === "save") {
        if (recommendations.enabled && !profiles.some(profile => profile.id === recommendations.profileId && declaredModels(profile).includes(recommendations.model || '')))
          throw new Error(t('请选择推荐问题使用的连接与模型。', 'Choose a connection and model for question recommendations.'));
        if (
          vision.enabled &&
          (!visionProfile || !visionModels.includes(vision.model || ""))
        )
          throw new Error(
            t(
              "请先明确声明视觉模型，并选择视觉连接与模型。",
              "Declare a vision-capable model, then choose its connection and model.",
            ),
          );
        const result = await writeWorkspaceSettings(() => api<Settings>("/settings", {
          method: "PUT", body: JSON.stringify(body),
        }), s => {
          onSaved(s);
          setProfiles(profileList(s).map(toDraft));
          setActive(s.activeProfileId || active);
          setVision(s.vision || { enabled: false });
          setRecommendations(s.recommendations || { enabled: false });
          setFeedback(t("配置已保存"));
        });
        if (!result.ok) throw new Error(result.error || t("其他模型配置正在保存，请稍后重试。", "Another model setting is being saved. Try again shortly."));
      } else {
        await api("/settings/test", {
          method: "POST",
          body: JSON.stringify({ ...body, activeProfileId: selected }),
        });
        setFeedback(t("连接成功，模型已响应。"));
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
        name: t(`连接 ${ps.length + 1}`, `Connection ${ps.length + 1}`),
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
    if (vision.profileId === draft.id) setVision({ enabled: false });
    if (recommendations.profileId === draft.id) setRecommendations({ enabled: false });
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
            <h2 id="settings-title">{t("模型与 API")}</h2>
          </div>
          <button
            className="icon-button"
            aria-label={t("关闭模型设置")}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <p className="settings-intro">
          {t("每个连接保存一组 API 和多个模型。")}
          <br />
          {t("摘要、翻译和问答都可以自由切换模型。")}
        </p>
        <div className="profile-list" aria-label={t("已保存的模型连接")}>
          {profiles.map((p) => (
            <button
              disabled={!!busy || sharedWrite.pending}
              key={p.id}
              className={p.id === draft.id ? "selected" : ""}
              onClick={() => {
                setSelected(p.id);
                setFeedback("");
              }}
            >
              <span title={p.name || t("未命名连接")}>
                {p.name || t("未命名连接")}
              </span>
              <small>
                {modelCountLabel(p.modelText)}
                {active === p.id ? t(" · 当前使用") : ""}
              </small>
            </button>
          ))}
          <button className="add-profile" onClick={add} disabled={!!busy || sharedWrite.pending}>
            <Plus size={15} /> {t("添加连接")}
          </button>
        </div>
        <label htmlFor="profile-name">{t("连接名称")}</label>
        <input disabled={!!busy || sharedWrite.pending}
          id="profile-name"
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={t("例如：个人 API / 本地模型")}
        />
        <label htmlFor="provider">{t("API 协议")}</label>
        <select disabled={!!busy || sharedWrite.pending}
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
          <option value="openai">{t("OpenAI 兼容")}</option>
          <option value="anthropic">Anthropic</option>
        </select>
        <label htmlFor="base-url">API Base URL</label>
        <input disabled={!!busy || sharedWrite.pending}
          id="base-url"
          value={draft.baseUrl}
          onChange={(e) => update({ baseUrl: e.target.value })}
          placeholder="https://api.example.com/v1"
        />
        <label htmlFor="models-list">{t("预填模型列表")}</label>
        <textarea disabled={!!busy || sharedWrite.pending}
          id="models-list"
          className="models-list"
          rows={4}
          value={draft.modelText}
          onChange={(e) => update({ modelText: e.target.value })}
          placeholder={t(
            "每行一个模型 ID，例如：\nmodel-fast\nmodel-reasoning\nmodel-vision",
          )}
        />
        <p className="field-hint">
          {t("同一 URL 与 API Key 共用；每行或逗号分隔一个模型 ID。")}
        </p>
        <label htmlFor="model">{t("模型名称")}</label>
        <input disabled={!!busy || sharedWrite.pending}
          id="model"
          list="configured-models"
          value={draft.model}
          onChange={(e) => update({ model: e.target.value })}
          placeholder={t("当前使用的模型 ID")}
        />
        <datalist id="configured-models">
          {draft.modelText
            .split(/[\n,，]+/)
            .filter(Boolean)
            .map((m) => (
              <option key={m.trim()} value={m.trim()} />
            ))}
        </datalist>
        {!!declaredModels(draft).length && (
          <fieldset className="model-capability-editor">
            <legend>{t("模型能力声明", "Model capabilities")}</legend>
            <p>
              {t(
                "默认为仅文本。请根据服务商文档声明视觉能力；不会根据模型名称猜测。",
                "Models default to text only. Declare vision support from your provider documentation; names are never used to infer capabilities.",
              )}
            </p>
            {declaredModels(draft).map((model) => (
              <label key={model}>
                <span title={model}>{model}</span>
                <select disabled={!!busy || sharedWrite.pending}
                  aria-label={t(`${model} 模型能力`, `${model} capabilities`)}
                  value={draft.modelCapabilities?.[model] || "text"}
                  onChange={(event) =>
                    update({
                      modelCapabilities: {
                        ...draft.modelCapabilities,
                        [model]:
                          event.target.value === "vision" ? "vision" : "text",
                      },
                    })
                  }
                >
                  <option value="text">{t("仅文本", "Text only")}</option>
                  <option value="vision">
                    {t("文本与图像", "Text and images")}
                  </option>
                </select>
              </label>
            ))}
          </fieldset>
        )}
        <label htmlFor="api-key">
          API Key{" "}
          {draft.apiKeyConfigured && !draft.clearApiKey && (
            <span className="configured">
              <Check size={12} /> {t("已配置")}
            </span>
          )}
        </label>
        <input disabled={!!busy || sharedWrite.pending}
          id="api-key"
          type="password"
          autoComplete="new-password"
          value={draft.apiKey || ""}
          onChange={(e) =>
            update({ apiKey: e.target.value, clearApiKey: false })
          }
          placeholder={
            draft.apiKeyConfigured
              ? t("已保存 · 留空以保留")
              : t("本地服务可留空")
          }
        />
        {draft.apiKeyConfigured && (
          <label className="checkbox-label">
            <input disabled={!!busy || sharedWrite.pending}
              type="checkbox"
              checked={draft.clearApiKey || false}
              onChange={(e) => update({ clearApiKey: e.target.checked })}
            />
            {t("清除已保存的 API Key")}
          </label>
        )}
        <div className="profile-actions">
          <label className="checkbox-label">
            <input disabled={!!busy || sharedWrite.pending}
              type="checkbox"
              checked={active === draft.id}
              onChange={() => setActive(draft.id)}
            />
            {t("将此连接设为当前使用")}
          </label>
          <button
            className="text-button danger"
            disabled={profiles.length < 2 || !!busy || sharedWrite.pending}
            onClick={remove}
          >
            <Trash2 size={13} /> {t("删除连接")}
          </button>
        </div>
        <section
          className="vision-settings"
          aria-label={t("图像分析设置", "Image analysis settings")}
        >
          <div className="vision-settings-heading">
            <Eye size={17} />
            <strong>{t("独立视觉模型", "Separate vision model")}</strong>
          </div>
          <p>
            {t(
              "文字研读和图像分析可以使用不同连接。只有主动点击分析图表才会发送裁切图像。",
              "Text reading and image analysis can use separate connections. A cropped figure is sent only when you explicitly analyze it.",
            )}
          </p>
          <label className="checkbox-label">
            <input disabled={!!busy || sharedWrite.pending}
              type="checkbox"
              checked={vision.enabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                if (!enabled) {
                  setVision((old) => ({ ...old, enabled: false }));
                  return;
                }
                const profile = visionProfile || visionProfiles[0];
                const model =
                  profile &&
                  declaredModels(profile).find(
                    (model) => profile.modelCapabilities?.[model] === "vision",
                  );
                setVision({
                  enabled,
                  profileId: profile?.id,
                  model:
                    profile?.id === vision.profileId &&
                    visionModels.includes(vision.model || "")
                      ? vision.model
                      : model,
                });
              }}
            />
            {t("启用图像分析", "Enable image analysis")}
          </label>
          {vision.enabled && (
            <>
              <label htmlFor="vision-profile">
                {t("视觉连接", "Vision connection")}
              </label>
              <select disabled={!!busy || sharedWrite.pending}
                id="vision-profile"
                value={vision.profileId || ""}
                onChange={(event) => {
                  const profile = visionProfiles.find(
                    (profile) => profile.id === event.target.value,
                  );
                  setVision({
                    enabled: true,
                    profileId: profile?.id,
                    model:
                      profile &&
                      declaredModels(profile).find(
                        (model) =>
                          profile.modelCapabilities?.[model] === "vision",
                      ),
                  });
                }}
              >
                <option value="">
                  {t(
                    "选择已声明视觉能力的连接",
                    "Choose a declared vision connection",
                  )}
                </option>
                {visionProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <label htmlFor="vision-model">
                {t("视觉模型", "Vision model")}
              </label>
              <select disabled={!!busy || sharedWrite.pending}
                id="vision-model"
                value={vision.model || ""}
                onChange={(event) =>
                  setVision((old) => ({ ...old, model: event.target.value }))
                }
              >
                <option value="">
                  {t("选择视觉模型", "Choose a vision model")}
                </option>
                {visionModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              {!visionProfiles.length && (
                <p className="vision-settings-empty">
                  {t(
                    "请先在上方模型能力中将至少一个模型设为“文本与图像”。",
                    "First mark at least one model above as Text and images.",
                  )}
                </p>
              )}
            </>
          )}
        </section>
        <section className="recommendation-settings" aria-label={t('推荐问题设置', 'Question recommendation settings')}>
          <h3><Sparkles size={17}/>{t('自动推荐问题', 'Suggested questions')}</h3>
          <p>{t('打开论文助手时，根据原文自动生成一组探索问题，并复用已保存的结果。点击问题只填入草稿，修改后再发送。', 'Opening a paper assistant generates question starters from the source, reusing saved results when available. Choosing a question fills an editable draft; it does not send it.')}</p>
          <label className="checkbox-label"><input id="recommendation-enabled" type="checkbox" disabled={!!busy || sharedWrite.pending} checked={recommendations.enabled} onChange={event => {
            const enabled = event.target.checked;
            const profile = profiles.find(profile => profile.id === recommendations.profileId) || profiles.find(profile => profile.id === active) || profiles[0];
            const models = declaredModels(profile);
            setRecommendations({ enabled, profileId: profile.id, model: models.includes(recommendations.model || '') ? recommendations.model : profile.model || models[0] });
          }}/>{t('启用自动推荐', 'Enable automatic recommendations')}</label>
          {recommendations.enabled && <><label htmlFor="recommendation-model">{t('推荐问题专用模型', 'Dedicated recommendation model')}</label>
            <select id="recommendation-model" disabled={!!busy || sharedWrite.pending} value={JSON.stringify([recommendations.profileId || '', recommendations.model || ''])} onChange={event => {
              const [profileId, model] = JSON.parse(event.target.value); setRecommendations({ enabled: true, profileId, model });
            }}><option value={JSON.stringify(['',''])}>{t('选择连接与模型', 'Choose a connection and model')}</option>
              {profiles.map(profile => <optgroup key={profile.id} label={profile.name}>{declaredModels(profile).filter(Boolean).map(model => <option value={JSON.stringify([profile.id,model])} key={model}>{model}</option>)}</optgroup>)}
            </select></>}
          <p>{t('与当前问答模型独立。生成会把论文选段发送给所选 API，并计入用量；默认关闭，可随时停用。已开始的请求可能仍产生消耗。', 'Independent of the chat model. Generation sends paper excerpts to the selected API and is tracked in usage. Off by default; disable any time. Requests already started may still incur usage.')}</p>
        </section>
        <details className="advanced-settings">
          <summary>
            {t("高级请求参数")} <ChevronDown size={12} />
          </summary>
          <label htmlFor="request-timeout">{t("单次模型请求超时（秒）", "Model request timeout (seconds)")}</label>
          <input disabled={!!busy || sharedWrite.pending}
            id="request-timeout"
            type="number"
            min={15}
            max={600}
            step={1}
            value={draft.requestTimeoutSeconds || 90}
            onChange={(event) => update({ requestTimeoutSeconds: Number(event.target.value) })}
          />
          <p className="field-hint">{t("慢速推理或高清图像可增加等待时间；每个连接独立设置，最多10分钟。", "Allow more time for slow reasoning or high-resolution images. Each connection has its own limit, up to 10 minutes.")}</p>
          <label htmlFor="context-budget">{t("论文上下文预算（字符）")}</label>
          <input disabled={!!busy || sharedWrite.pending}
            id="context-budget"
            type="number"
            min="8000"
            max="300000"
            step="1000"
            value={draft.contextChars || 44000}
            onChange={(e) => update({ contextChars: Number(e.target.value) })}
          />
          <label htmlFor="max-output">{t("模型输出上限（Tokens）")}</label>
          <input disabled={!!busy || sharedWrite.pending}
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
          <label htmlFor="extra-body">{t("额外 JSON 参数")}</label>
          <textarea disabled={!!busy || sharedWrite.pending}
            id="extra-body"
            spellCheck={false}
            value={draft.extra}
            onChange={(e) => update({ extra: e.target.value })}
          />
        </details>
        <div className="settings-privacy">
          <ShieldCheck size={17} />
          <p>
            {t(
              "密钥仅保存在本机服务端。配置和论文不随源码分享；生成、提问或启用自动推荐时会向所选服务发送相关内容。",
              "Keys stay on your local server. Configuration and papers are not shared with the source code. Generation, questions and enabled automatic recommendations send relevant content to your chosen provider.",
            )}
          </p>
        </div>
        {sharedWrite.pending && busy !== "save" && <p className="field-hint" role="status">{t("正在应用模型设置，请稍候…", "Applying model settings. Please wait…")}</p>}
        {feedback && (
          <div className={failed ? "form-error" : "form-success"} role="status">
            {feedback}
          </div>
        )}
        <div className="settings-actions">
          <button
            className="soft-button"
            disabled={!!busy || sharedWrite.pending || !draft.model || !draft.baseUrl}
            onClick={() => run("test")}
          >
            {busy === "test" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Globe2 size={15} />
            )}
            {t("测试连接")}
          </button>
          <button
            className="primary-button"
            disabled={!!busy || sharedWrite.pending}
            onClick={() => run("save")}
          >
            {busy === "save" ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            {t("保存配置")}
          </button>
        </div>
        <div className="settings-footer">
          {t("也可以使用已登录的 Codex / Claude 会话和项目 skill")}
          <br />
          {t("直接写入解读，无需配置额外 API。")}
        </div>
      </section>
    </div>
  );
}
