import {EFFORT_LEVELS, type ModelReasoning, type ReasoningProtocol} from '../shared/model-reasoning.mjs';
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CONTEXT_CHARS, MIN_CONTEXT_CHARS, MAX_CONTEXT_CHARS, DEFAULT_OUTPUT_TOKENS, MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS } from '../shared/model-limits.mjs';
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
  const [dirty,setDirty]=useState(false);
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
    setDirty(true);
    if (patch.modelText !== undefined) {
      const models = [...new Set(patch.modelText.split(/[\n,，]+/).map(value=>value.trim()).filter(Boolean))];
      if (!models.includes(draft.model)) patch.model = models[0] || '';
      patch.modelCapabilities = {...draft.modelCapabilities};
      for (const entry of draft.disabledModels || []) if(models.includes(entry.model) && !draft.models.includes(entry.model)) {patch.modelCapabilities[entry.model]=entry.capability;if(entry.reasoning)patch.modelReasoning={...draft.modelReasoning,...patch.modelReasoning,[entry.model]:entry.reasoning};}
      if(vision.profileId===draft.id&&!models.includes(vision.model||''))setVision(old=>({...old,enabled:false}));
      if(recommendations.profileId===draft.id&&!models.includes(recommendations.model||''))setRecommendations(old=>({...old,enabled:false}));
    }
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
                    modelReasoning: {},
                    disabledModels: [],
                  }
                : {}),
            },
      ),
    );
  };
  const payload = (excludedProfileId?: string) => ({
    activeProfileId: active,
    vision,
    recommendations,
    profiles: profiles.filter(profile => profile.id !== excludedProfileId).map(({ extra, modelText, ...p }) => {
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
  async function run(action: "save" | "test", removeProfileId?: string) {
    if (busy || sharedWrite.pending) return;
    setBusy(action);
    setFeedback("");
    try {
      const body = payload(removeProfileId);
      if (removeProfileId) {
        if (!body.profiles.length) throw new Error(t('至少保留一个连接。', 'Keep at least one connection.'));
        if (body.activeProfileId === removeProfileId) body.activeProfileId = body.profiles[0].id;
        if (body.vision.profileId === removeProfileId) body.vision = { enabled: false };
        if (body.recommendations.profileId === removeProfileId) body.recommendations = { enabled: false };
      }
      if (action === "save") {
        if (body.recommendations.enabled && !body.profiles.some(profile => profile.id === body.recommendations.profileId && profile.models.includes(body.recommendations.model || '')))
          throw new Error(t('请选择推荐问题使用的连接与模型。', 'Choose a connection and model for question recommendations.'));
        if (
          body.vision.enabled &&
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
          if (removeProfileId) setSelected(body.activeProfileId);
          setVision(s.vision || { enabled: false });
          setRecommendations(s.recommendations || { enabled: false });
          setDirty(false);
          setFeedback(t("配置已保存到本机服务端，重启后仍保留。", "Saved on the local server and retained after restart."));
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
  async function restore(body: {restoreProfileId?:string;restoreModel?:{profileId:string;model:string}}){
    if(dirty||busy||sharedWrite.pending)return;
    setBusy('restore');setFeedback('');
    const result=await writeWorkspaceSettings(()=>api<Settings>('/settings',{method:'PUT',body:JSON.stringify(body)}),value=>{
      onSaved(value);setProfiles(profileList(value).map(toDraft));
      if(body.restoreProfileId)setSelected(body.restoreProfileId);
      setFeedback(t('已恢复并保存到本机服务端。','Restored and saved on the local server.'));setFailed(false);
    });
    if(!result.ok){setFeedback(result.error||t('恢复失败，请重试。','Restore failed. Please retry.'));setFailed(true);}
    setBusy('');
  }
  function add() {
    setDirty(true);
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
    if (profiles.length < 2) return;
    // Persist before removing from the form, so closing the drawer cannot undo it.
    void run("save", draft.id);
  }
  return (
    <div
      className="modal-backdrop settings-backdrop"
      onChangeCapture={()=>setDirty(true)}
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
        <p className="field-hint" role="status">{dirty?t('有未保存的更改，请点击「保存配置」。','Unsaved changes. Choose Save configuration to persist them.'):t('配置保存在本机服务端；助手里的模型切换、风格、联网与阅读方式自动保存。','Configuration is stored on the local server. Assistant model, style, Web search and reading-mode changes save automatically.')}</p>
        {!!current.disabledProfiles?.length && <details className="settings-disabled-list"><summary>{t('已停用的连接','Disabled connections')} ({current.disabledProfiles.length})</summary>
          {current.disabledProfiles.map(profile=><div key={profile.id}><span>{profile.name} · {profile.models.length} {t('个模型','models')}</span><button className="text-button" disabled={dirty||!!busy||sharedWrite.pending} onClick={()=>void restore({restoreProfileId:profile.id})}>{t('恢复','Restore')}</button></div>)}
          {dirty&&<small>{t('请先保存当前更改再恢复。','Save current changes before restoring.')}</small>}
        </details>}
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
          {t("同一 URL 与 API Key 共用；每行或逗号分隔一个模型 ID。移除后停用，可恢复；编辑后请保存。", "Models share the URL and API key. Separate IDs with lines or commas. Removed models are disabled and recoverable; save after editing.")}
        </p>
        {!!draft.disabledModels?.length && <details className="settings-disabled-list"><summary>{t('已停用的模型','Disabled models')} ({draft.disabledModels.length})</summary>
          {draft.disabledModels.map(entry=><div key={entry.model}><span>{entry.model}</span><button className="text-button" disabled={dirty||!!busy||sharedWrite.pending} onClick={()=>void restore({restoreModel:{profileId:draft.id,model:entry.model}})}>{t('恢复','Restore')}</button></div>)}
        </details>}
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
        <details className="model-reasoning-editor"><summary>{t('思考强度设置','Reasoning controls')} · {draft.model}</summary>
          <p className="field-hint">{t('已收录的官方接口和已配置的分级模型会自动提供滑块。其他接口请按服务商文档声明；不操作滑块时保留原有参数。','Documented endpoints and saved model variants provide a slider automatically. Declare other interfaces from provider documentation; requests stay unchanged until you adjust the slider.')}</p>
          <label>{t('当前模型的控制方式','Control protocol for this model')}<select disabled={!!busy||sharedWrite.pending} value={draft.modelReasoning?.[draft.model]?.protocol || ''} onChange={event=>{
            const next={...draft.modelReasoning};
            if(!event.target.value)delete next[draft.model];
            else next[draft.model]={protocol:event.target.value as ReasoningProtocol,levels:event.target.value.endsWith('-toggle')?['off','on']:['low','medium','high'],value:'default'};
            update({modelReasoning:next});
          }}><option value="">{t('自动识别官方接口／已配置变体','Documented endpoints / saved variants')}</option>
            {draft.provider==='openai'&&<option value="openai-effort">OpenAI · reasoning_effort</option>}
            {draft.provider==='anthropic'&&<option value="anthropic-effort">Anthropic · adaptive + effort</option>}
            {draft.provider==='openai'&&<><option value="thinking-toggle">thinking.type · {t('开关','on/off')}</option><option value="template-toggle">chat_template_kwargs.thinking · {t('开关','on/off')}</option></>}
          </select></label>
          {draft.modelReasoning?.[draft.model]&&!draft.modelReasoning[draft.model].protocol.endsWith('-toggle')&&<label>{t('支持的等级（按滑块顺序，逗号分隔）','Supported levels (slider order, comma-separated)')}<input disabled={!!busy||sharedWrite.pending} value={draft.modelReasoning[draft.model].levels.join(', ')} placeholder={EFFORT_LEVELS.join(', ')} onChange={event=>{const entry=draft.modelReasoning![draft.model];const levels=event.target.value.split(',').map(value=>value.trim());update({modelReasoning:{...draft.modelReasoning,[draft.model]:{...entry,levels,value:levels.includes(entry.value)?entry.value:'default'} as ModelReasoning}});}}/></label>}
          <p className="field-hint">{t('默认表示沿用连接参数；不保证所有接口支持所有等级。更高强度可能增加时延与用量。','Default keeps connection parameters. Supported levels vary by endpoint. Higher effort may increase latency and usage.')}</p>
        </details>
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
            <Trash2 size={13} /> {t("停用并保存", "Disable and save")}
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
              "文字研读和图像分析可使用不同连接。此模型可为纯文本摘要模型先读图，也可单独分析选中的图表。",
              "Text reading and image analysis can use separate connections. This model can read images for text-only overview models, and analyze selected figures.",
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
          <p className="field-hint">{t("流式生成按连续无数据时间计时；持续输出不会因总时长被切断。每个连接可设置最多 10 分钟的无响应等待。", "Streaming calls time out only after inactivity; active output extends the wait. Each connection allows up to 10 minutes without data.")}</p>
          <p className="field-hint">{t("PDF 问答：15 页以内按页序提供完整提取原文；更长论文先给简要资料，再按需读整页。此字符预算用于报告和其他来源，不截断 PDF 问答的单页。", "PDF questions: up to 15 pages are supplied in full order; longer papers start with a brief and load whole pages on demand. This character budget applies to reports and other sources, not truncation within PDF question pages.")}</p>
          <label htmlFor="context-budget">{t("论文上下文预算（字符）")}</label>
          <input disabled={!!busy || sharedWrite.pending}
            id="context-budget"
            type="number"
            min={MIN_CONTEXT_CHARS}
            max={MAX_CONTEXT_CHARS}
            step="1000"
            value={draft.contextChars || DEFAULT_CONTEXT_CHARS}
            onChange={(e) => update({ contextChars: Number(e.target.value) })}
          />
          <p className="field-hint">{t("可调至 800 万字符。字符不等于 tokens；总上下文还包含历史、图像、提示词和模型输出。1M / 2M token 模型可按语言与服务端报错手动调整。", "Up to 8 million characters. Characters are not tokens; history, images, prompts and output also consume context. Adjust for your language and provider's 1M / 2M token limits.")}</p>
          <label htmlFor="max-output">{t("模型输出上限（Tokens）")}</label>
          <input disabled={!!busy || sharedWrite.pending}
            id="max-output"
            type="number"
            min={MIN_OUTPUT_TOKENS}
            max={MAX_OUTPUT_TOKENS}
            step="512"
            value={draft.maxOutputTokens ?? DEFAULT_OUTPUT_TOKENS}
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
