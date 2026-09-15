"use client";

/* eslint-disable @next/next/no-img-element -- previews use local IndexedDB object URLs */

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AiRequestError,
  createAiGeneration,
  downloadAiAsset,
  loadAiConfig,
  queryAiGeneration,
  type AiConfig,
  type AiGeneratedAsset,
  type AiGeneration,
  type AiModelId,
  type AiReferenceKind,
  type AiReferenceUpload,
} from "../ai";
import { loadStoredAssets, saveStoredAsset, type StoredAssetRecord } from "../storage";

type ReferenceCandidate = AiReferenceUpload & {
  name: string;
  url: string;
  source: "library" | "computer";
  size: number;
};

type SavedResult = {
  id: string;
  kind: "image" | "video";
  name: string;
  url: string;
  file: File;
  saved: boolean;
  saveError?: string;
};

const MODELS: Array<{
  id: AiModelId;
  label: string;
  eyebrow: string;
  description: string;
  referenceText: string;
}> = [
  { id: "gpt-image-2", label: "GPT Image 2", eyebrow: "OPENAI IMAGE", description: "文字生图 · 多图编辑", referenceText: "最多 4 张参考图片" },
  { id: "seedream-5", label: "Seedream 5.0", eyebrow: "DOUBAO IMAGE", description: "高质感生图 · 多图融合", referenceText: "最多 6 张参考图片" },
  { id: "minimax-h3", label: "MiniMax H3", eyebrow: "MINIMAX VIDEO", description: "768P 视频 · 5–15 秒", referenceText: "首帧和尾帧图片" },
  { id: "seedance-2", label: "Seedance 2.0", eyebrow: "DOUBAO VIDEO", description: "多模态视频 · 原生声音", referenceText: "图片、视频和音频" },
  { id: "seedance-2-5", label: "Seedance 2.5", eyebrow: "DOUBAO VIDEO", description: "720P 视频 · 4–30 秒", referenceText: "最多 30 张图片和 10 个音频" },
];

const RATIOS = [
  { value: "1:1", label: "1:1", shape: "square" },
  { value: "16:9", label: "16:9", shape: "landscape" },
  { value: "9:16", label: "9:16", shape: "portrait" },
  { value: "4:3", label: "4:3", shape: "classic" },
  { value: "3:4", label: "3:4", shape: "classic-portrait" },
  { value: "3:2", label: "3:2", shape: "photo" },
  { value: "2:3", label: "2:3", shape: "photo-portrait" },
  { value: "21:9", label: "21:9", shape: "cinema" },
];

const KIND_LABELS: Record<AiReferenceKind, string> = { image: "图片", video: "视频", audio: "音频" };

function kindFromFile(file: File): AiReferenceKind | undefined {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return undefined;
}

function allowedKinds(model: AiModelId): AiReferenceKind[] {
  if (model === "seedance-2") return ["image", "video", "audio"];
  if (model === "seedance-2-5") return ["image", "audio"];
  return ["image"];
}

function referenceLimit(model: AiModelId): number {
  if (model === "minimax-h3") return 2;
  if (model === "gpt-image-2") return 4;
  if (model === "seedance-2-5") return 40;
  return 6;
}

function referenceTypeLimit(model: AiModelId, kind: AiReferenceKind): number {
  if (!allowedKinds(model).includes(kind)) return 0;
  if (model === "seedance-2-5") return kind === "image" ? 30 : 10;
  return referenceLimit(model);
}

function modelSupportsReference(model: AiModelId, kind: AiReferenceKind): boolean {
  return allowedKinds(model).includes(kind);
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function asFile(record: StoredAssetRecord): File {
  return record.file instanceof File ? record.file : new File([record.file], record.name, { type: record.mime });
}

function compatibleRatios(model: AiModelId) {
  void model;
  return RATIOS;
}

function videoDurationRange(model: AiModelId): { minimum: number; maximum: number } {
  if (model === "minimax-h3") return { minimum: 5, maximum: 15 };
  if (model === "seedance-2-5") return { minimum: 4, maximum: 30 };
  return { minimum: 4, maximum: 15 };
}

function durationOptions(model: AiModelId): number[] {
  const { minimum, maximum } = videoDurationRange(model);
  return Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
}

function nextReferenceTag(references: ReferenceCandidate[], kind: AiReferenceKind): string {
  const used = references
    .filter((reference) => reference.kind === kind)
    .map((reference) => Number(reference.tag.match(/(\d+)$/)?.[1] ?? 0));
  return `@${KIND_LABELS[kind]}${Math.max(0, ...used) + 1}`;
}

export default function AiCreationPage() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [model, setModel] = useState<AiModelId>("gpt-image-2");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [resolution, setResolution] = useState<"1K" | "2K" | "4K">("2K");
  const [quality, setQuality] = useState("medium");
  const [duration, setDuration] = useState(6);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [libraryReferences, setLibraryReferences] = useState<ReferenceCandidate[]>([]);
  const [selectedReferences, setSelectedReferences] = useState<ReferenceCandidate[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [generation, setGeneration] = useState<AiGeneration | null>(null);
  const [submittedPrompt, setSubmittedPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savedResults, setSavedResults] = useState<SavedResult[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptEditorRef = useRef<HTMLDivElement>(null);
  const savedPromptRangeRef = useRef<Range | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const selectedModel = MODELS.find((item) => item.id === model) ?? MODELS[0];
  const selectedConfig = config?.models.find((item) => item.id === model);
  const modelAvailable = selectedConfig?.available === true;
  const modelKind = selectedConfig?.kind ?? (model === "gpt-image-2" || model === "seedream-5" ? "image" : "video");
  const promptMaximum = model === "gpt-image-2" ? 1000 : model === "minimax-h3" ? 2000 : 4000;
  const invalidReferences = selectedReferences.filter((reference) => !modelSupportsReference(model, reference.kind));
  const tooManyReferences = selectedReferences.length > referenceLimit(model)
    || allowedKinds(model).some((kind) => selectedReferences.filter((reference) => reference.kind === kind).length > referenceTypeLimit(model, kind));
  const taskActive = generation?.status === "queued" || generation?.status === "running";
  const estimate = model === "gpt-image-2"
    ? "约 ¥0.07 / 张"
    : model === "seedream-5"
      ? "按 New.bi 实际用量"
      : model === "minimax-h3"
        ? `约 ¥${(duration * 0.3).toFixed(2)}`
        : model === "seedance-2-5"
          ? `约 ¥${(duration * 1.9).toFixed(2)}`
          : `约 ¥${(duration * 0.85).toFixed(2)}`;

  const availableReferences = useMemo(() => {
    const keyword = pickerQuery.trim().toLowerCase();
    return libraryReferences.filter((reference) => {
      if (!modelSupportsReference(model, reference.kind)) return false;
      if (selectedReferences.some((selected) => selected.id === reference.id)) return false;
      return !keyword || reference.name.toLowerCase().includes(keyword) || KIND_LABELS[reference.kind].includes(keyword);
    });
  }, [libraryReferences, model, pickerQuery, selectedReferences]);

  useEffect(() => {
    let active = true;
    Promise.all([loadAiConfig(), loadStoredAssets()])
      .then(([nextConfig, records]) => {
        if (!active) return;
        setConfig(nextConfig);
        const savedToken = window.sessionStorage.getItem("frame-vault-ai-access-token");
        if (savedToken) setAccessToken(savedToken);
        const references = records.flatMap((record): ReferenceCandidate[] => {
          if (record.kind !== "image" && record.kind !== "video" && record.kind !== "audio") return [];
          const file = asFile(record);
          const url = URL.createObjectURL(file);
          objectUrlsRef.current.push(url);
          return [{ id: record.id, kind: record.kind, tag: "", file, name: record.name, url, source: "library", size: file.size }];
        });
        setLibraryReferences(references);
      })
      .catch(() => setError("无法读取本机 AI 配置或素材库，请确认本地服务仍在运行。"))
      .finally(() => {
        if (!active) return;
        setConfigLoading(false);
        setLibraryLoading(false);
      });
    return () => {
      active = false;
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current = [];
    };
  }, []);

  const nextTag = useCallback((kind: AiReferenceKind) => {
    return nextReferenceTag(selectedReferences, kind);
  }, [selectedReferences]);

  const addReference = useCallback((candidate: ReferenceCandidate) => {
    if (selectedReferences.some((reference) => reference.id === candidate.id)) return;
    if (!modelSupportsReference(model, candidate.kind)) {
      setError(`${selectedModel.label} 不支持${KIND_LABELS[candidate.kind]}参考。`);
      return;
    }
    if (selectedReferences.length >= referenceLimit(model)) {
      setError(`${selectedModel.label} 最多添加 ${referenceLimit(model)} 个参考素材。`);
      return;
    }
    if (selectedReferences.filter((reference) => reference.kind === candidate.kind).length >= referenceTypeLimit(model, candidate.kind)) {
      setError(`${selectedModel.label} 最多添加 ${referenceTypeLimit(model, candidate.kind)} 个${KIND_LABELS[candidate.kind]}参考。`);
      return;
    }
    const tag = nextTag(candidate.kind);
    setSelectedReferences((current) => [...current, { ...candidate, tag }]);
    setError("");
    setPickerOpen(false);
  }, [model, nextTag, selectedModel.label, selectedReferences]);

  const removeReference = (id: string) => {
    setSelectedReferences((current) => current.filter((reference) => reference.id !== id));
    const editor = promptEditorRef.current;
    if (editor) {
      editor.querySelectorAll<HTMLElement>("[data-reference-id]").forEach((token) => {
        if (token.dataset.referenceId === id) token.remove();
      });
      setPrompt(editor.innerText.replace(/ {2,}/g, " ").trimStart());
    }
  };

  const chooseComputerFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const nextReferences = [...selectedReferences];
    let nextError = "";
    files.forEach((file) => {
      const kind = kindFromFile(file);
      if (!kind) return;
      if (!modelSupportsReference(model, kind)) {
        nextError = `${selectedModel.label} 不支持${KIND_LABELS[kind]}参考。`;
        return;
      }
      if (nextReferences.length >= referenceLimit(model)) {
        nextError = `${selectedModel.label} 最多添加 ${referenceLimit(model)} 个参考素材。`;
        return;
      }
      if (nextReferences.filter((reference) => reference.kind === kind).length >= referenceTypeLimit(model, kind)) {
        nextError = `${selectedModel.label} 最多添加 ${referenceTypeLimit(model, kind)} 个${KIND_LABELS[kind]}参考。`;
        return;
      }
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      const tag = nextReferenceTag(nextReferences, kind);
      nextReferences.push({
        id: `computer-${crypto.randomUUID()}`,
        kind,
        tag,
        file,
        name: file.name,
        url,
        source: "computer",
        size: file.size,
      });
    });
    setSelectedReferences(nextReferences);
    setError(nextError);
    setPickerOpen(false);
    event.target.value = "";
  };

  const capturePromptSelection = () => {
    const editor = promptEditorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && selection.anchorNode && editor.contains(selection.anchorNode)) {
      savedPromptRangeRef.current = selection.getRangeAt(0).cloneRange();
      const node = selection.anchorNode;
      const beforeCaret = node.nodeType === Node.TEXT_NODE
        ? (node.textContent ?? "").slice(0, selection.anchorOffset)
        : "";
      setMentionOpen(beforeCaret.endsWith("@"));
    }
    setPrompt(editor.innerText);
  };

  const insertMention = (reference: ReferenceCandidate) => {
    const editor = promptEditorRef.current;
    const selection = window.getSelection();
    const savedRange = savedPromptRangeRef.current;
    if (!editor || !selection || !savedRange) return;
    const range = savedRange.cloneRange();
    const start = range.startContainer;
    if (start.nodeType === Node.TEXT_NODE && range.startOffset > 0 && start.textContent?.[range.startOffset - 1] === "@") {
      range.setStart(start, range.startOffset - 1);
      range.deleteContents();
    }
    const token = document.createElement("span");
    token.className = `creation-mention-token ${reference.kind}`;
    token.contentEditable = "false";
    token.dataset.referenceId = reference.id;
    token.textContent = reference.tag;
    const trailingSpace = document.createTextNode(" ");
    range.insertNode(trailingSpace);
    range.insertNode(token);
    range.setStartAfter(trailingSpace);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    savedPromptRangeRef.current = range.cloneRange();
    setPrompt(editor.innerText);
    setMentionOpen(false);
    editor.focus();
  };

  const saveGeneratedResult = useCallback(async (result: SavedResult, usedPrompt: string) => {
    const now = Date.now();
    const record: StoredAssetRecord = {
      id: result.id,
      file: result.file,
      name: result.name,
      kind: result.kind,
      extension: result.name.includes(".") ? result.name.split(".").pop()?.toUpperCase() ?? "AI" : "AI",
      mime: result.file.type || (result.kind === "image" ? "image/webp" : "video/mp4"),
      size: result.file.size,
      status: "reading",
      prompt: usedPrompt,
      category: "未分类",
      collection: "library",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await saveStoredAsset(record);
      setSavedResults((current) => current.map((item) => item.id === result.id
        ? { ...item, saved: true, saveError: undefined }
        : item));
      return true;
    } catch (caught) {
      const saveError = caught instanceof Error ? caught.message : "本地素材库写入失败。";
      setSavedResults((current) => current.map((item) => item.id === result.id
        ? { ...item, saved: false, saveError }
        : item));
      return false;
    }
  }, []);

  const storeAssets = useCallback(async (assets: AiGeneratedAsset[], usedPrompt: string) => {
    if (!assets.length) throw new AiRequestError("任务完成但没有可保存的素材。", "EMPTY_RESULT");
    const results: SavedResult[] = [];
    for (const asset of assets) {
      const file = await downloadAiAsset(asset, accessToken);
      const kind = kindFromFile(file);
      if (kind !== "image" && kind !== "video") throw new AiRequestError("生成结果不是受支持的图片或视频。", "UNSUPPORTED_RESULT");
      const id = crypto.randomUUID();
      const result: SavedResult = {
        id,
        kind,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
        saved: false,
      };
      objectUrlsRef.current.push(result.url);
      results.push(result);
      // Register the downloaded file before IndexedDB is touched, so a write
      // failure cannot make a completed generation disappear from the page.
      setSavedResults((current) => [...current, result]);
      result.saved = await saveGeneratedResult(result, usedPrompt);
    }
    return results;
  }, [accessToken, saveGeneratedResult]);

  const copyGeneratedPrompt = async () => {
    const value = submittedPrompt || prompt.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage("本次提示词已复制。生成结果会保留在此页面，直到提交新的生成任务或关闭页面。");
    } catch {
      setError("提示词复制失败，请在编辑区手动复制。");
    }
  };

  const retrySaveGeneratedResult = async (result: SavedResult) => {
    setMessage(`正在重新保存“${result.name}”…`);
    const saved = await saveGeneratedResult(result, submittedPrompt || prompt.trim());
    if (saved) setMessage(`“${result.name}”已保存到本机素材库。生成结果和提示词仍保留在当前页面。`);
    else setError(`“${result.name}”仍未保存。请先下载原文件并检查浏览器存储空间后重试。`);
  };

  const submit = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return setError("请先描述你想生成的画面。 ");
    if (!modelAvailable) return setError(`${selectedModel.label} 尚未配置可用密钥。`);
    if (invalidReferences.length || tooManyReferences) return setError("当前参考素材与所选模型不兼容，请先调整。 ");
    if (config?.accessTokenRequired && !accessToken.trim()) return setError("请输入工作台访问口令。 ");
    if (accessToken) window.sessionStorage.setItem("frame-vault-ai-access-token", accessToken);

    setBusy(true);
    setError("");
    setMessage(modelKind === "image" ? "正在生成图片，请不要重复提交…" : "正在提交视频任务…");
    setGeneration(null);
    setSavedResults([]);
    setSubmittedPrompt(cleanPrompt);
    setPollAttempt(0);
    setPollingPaused(false);
    try {
      const next = await createAiGeneration({
        model,
        prompt: cleanPrompt,
        parameters: modelKind === "image"
          ? { ratio, resolution, quality, format: "webp" }
          : { ratio, resolution: model === "minimax-h3" ? "768P" : "720P", duration, generateAudio },
      }, accessToken, selectedReferences);
      if (next.status === "succeeded" && next.assets?.length) {
        setMessage("生成成功，正在写入本机素材库…");
        const results = await storeAssets(next.assets, cleanPrompt);
        setGeneration(next);
        const failedCount = results.filter((result) => !result.saved).length;
        setMessage(failedCount
          ? `生成完成。${failedCount} 个素材暂未写入本地库，但预览、原文件下载和提示词仍保留在本页，可重试保存。`
          : "生成结果已保存到本机素材库；预览和本次提示词会保留在本页。");
      } else if (next.taskId) {
        setGeneration(next);
        setMessage("任务已经提交，工作台会自动查询进度。 ");
      } else {
        throw new AiRequestError("服务没有返回可查询的任务编号。", "MISSING_TASK_ID");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成请求失败，请稍后重试。 ");
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (pollingPaused || !generation?.taskId || generation.status === "succeeded" || generation.status === "failed") return;
    const reachedLimit = pollAttempt >= 80;
    const timer = window.setTimeout(() => {
      if (reachedLimit) {
        setPollingPaused(true);
        setError("已经查询约 20 分钟，自动查询已暂停；任务可能仍在 New.bi 运行。 ");
        return;
      }
      void queryAiGeneration(generation.model, generation.taskId!, accessToken)
        .then(async (next) => {
          if (next.status === "succeeded" && next.assets?.length) {
            setBusy(true);
            setMessage("视频生成完成，正在保存到本机素材库…");
            try {
              const results = await storeAssets(next.assets, submittedPrompt);
              setGeneration(next);
              const failedCount = results.filter((result) => !result.saved).length;
              setMessage(failedCount
                ? `视频生成完成。${failedCount} 个素材暂未写入本地库，但预览、原文件下载和提示词仍保留在本页，可重试保存。`
                : "视频已保存到本机素材库；预览和本次提示词会保留在本页。");
            } catch (caught) {
              setGeneration(next);
              setError(caught instanceof Error ? `视频已生成，但本地保存失败：${caught.message}` : "视频已生成，但本地保存失败。 ");
            } finally {
              setBusy(false);
            }
          } else if (next.status === "failed") {
            setGeneration(next);
            setError("New.bi 视频任务生成失败，请查看任务日志。 ");
            setMessage("");
          } else {
            setGeneration(next);
            setMessage(next.status === "queued" ? "任务仍在队列中…" : "正在生成视频…");
            setPollAttempt((attempt) => attempt + 1);
          }
        })
        .catch((caught) => {
          const requestError = caught instanceof AiRequestError ? caught : null;
          if (requestError && [401, 403, 503].includes(requestError.status)) {
            setPollingPaused(true);
            setError(requestError.message);
            return;
          }
          setMessage("暂时无法查询进度，稍后会自动再试…");
          setPollAttempt((attempt) => attempt + 1);
        });
    }, reachedLimit ? 0 : Math.min(15_000, 3_000 + pollAttempt * 1_500));
    return () => window.clearTimeout(timer);
  }, [accessToken, generation, pollAttempt, pollingPaused, storeAssets, submittedPrompt]);

  const canSubmit = Boolean(
    prompt.trim()
    && modelAvailable
    && !busy
    && !taskActive
    && !invalidReferences.length
    && !tooManyReferences
    && (!config?.accessTokenRequired || accessToken.trim()),
  );

  return (
    <main className="creation-shell">
      <header className="creation-topbar">
        <Link href="/" className="creation-back" aria-label="返回素材库">←</Link>
        <div className="creation-brand">
          <span>FRAME VAULT / AI LAB</span>
          <h1>生成工作台</h1>
        </div>
        <div className="creation-security"><i /> API KEY 仅在本机服务端</div>
        <Link href="/" className="creation-library-link">返回素材库</Link>
      </header>

      <div className="creation-grid">
        <aside className="creation-model-panel">
          <div className="creation-panel-title"><span>01</span><div><strong>生成模型</strong><small>MODEL ROUTER</small></div></div>
          <div className="creation-model-list">
            {MODELS.map((item) => {
              const available = config?.models.find((configured) => configured.id === item.id)?.available === true;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={model === item.id ? "active" : ""}
                  onClick={() => {
                    setModel(item.id);
                    const allowed = compatibleRatios(item.id);
                    if (!allowed.some((itemRatio) => itemRatio.value === ratio)) setRatio(allowed[0].value);
                    if (item.id !== "gpt-image-2" && item.id !== "seedream-5") {
                      const { minimum, maximum } = videoDurationRange(item.id);
                      setDuration((current) => Math.max(minimum, Math.min(maximum, current)));
                    }
                    setError("");
                  }}
                >
                  <i className={available ? "ready" : "missing"} />
                  <span>{item.eyebrow}</span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                  <em>{item.referenceText}</em>
                </button>
              );
            })}
          </div>
          <div className="creation-model-note">
            <span>{selectedModel.eyebrow}</span>
            <p>{selectedModel.referenceText}。素材只在提交生成时发送给当前模型。</p>
          </div>
        </aside>

        <section className="creation-compose-panel">
          <div className="creation-compose-head">
            <div>
              <span>02 / CREATIVE BRIEF</span>
              <h2>描述你想生成的内容</h2>
            </div>
            <strong>{prompt.length} / {promptMaximum}</strong>
          </div>

          <div className="creation-prompt-box">
            <div
              ref={promptEditorRef}
              className="creation-prompt-editor"
              contentEditable={!busy && !taskActive}
              suppressContentEditableWarning
              role="textbox"
              tabIndex={0}
              aria-multiline="true"
              aria-label="生成提示词"
              data-placeholder="写下画面、人物、动作、镜头、光线与声音；先添加参考素材，再输入 @ 引用…"
              onInput={capturePromptSelection}
              onKeyUp={capturePromptSelection}
              onMouseUp={capturePromptSelection}
              onKeyDown={(event) => {
                if (event.key === "Escape") setMentionOpen(false);
                if (prompt.length >= promptMaximum && event.key.length === 1 && !event.ctrlKey && !event.metaKey) event.preventDefault();
              }}
            />
            {mentionOpen && (
              <div className="creation-mention-menu">
                <header><strong>@ 引用已添加素材</strong><small>选择后插入到当前光标</small></header>
                <div>
                  {selectedReferences.map((reference) => (
                    <button
                      type="button"
                      key={reference.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => insertMention(reference)}
                    >
                      <span className={`creation-reference-thumb ${reference.kind}`}>
                        {reference.kind === "image" ? <img src={reference.url} alt="" /> : reference.kind === "video" ? "▶" : "♫"}
                      </span>
                      <strong>{reference.tag}</strong>
                      <small>{reference.name}</small>
                    </button>
                  ))}
                  {!selectedReferences.length && <p>先用下方按钮添加参考素材，之后输入 @ 即可引用。</p>}
                </div>
              </div>
            )}
            <div className="creation-prompt-actions">
              <button type="button" onClick={() => setPickerOpen((open) => !open)} disabled={busy || taskActive}>
                <span>@</span> 引用素材库
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy || taskActive}>
                <span>＋</span> 从电脑添加
              </button>
              <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*" onChange={chooseComputerFiles} className="visually-hidden" />
              <small>图片 ≤ 10 MB · 音频 ≤ 20 MB · 视频 ≤ 30 MB</small>
            </div>
          </div>

          {pickerOpen && (
            <div className="creation-picker">
              <header>
                <div><strong>@ 选择参考素材</strong><small>只显示当前模型支持的类型</small></div>
                <button type="button" onClick={() => setPickerOpen(false)} aria-label="关闭素材选择器">×</button>
              </header>
              <input value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="搜索本机素材库…" />
              <div className="creation-picker-grid">
                {availableReferences.map((candidate) => (
                  <button type="button" key={candidate.id} onClick={() => addReference(candidate)}>
                    <span className={`creation-reference-thumb ${candidate.kind}`}>
                      {candidate.kind === "image" ? <img src={candidate.url} alt="" /> : candidate.kind === "video" ? "▶" : "♫"}
                    </span>
                    <strong>{candidate.name}</strong>
                    <small>{KIND_LABELS[candidate.kind]} · {formatBytes(candidate.size)}</small>
                  </button>
                ))}
                {!availableReferences.length && <p>{libraryLoading ? "正在读取素材库…" : "没有可选素材，可从电脑临时添加。"}</p>}
              </div>
            </div>
          )}

          <div className="creation-reference-strip">
            <div className="creation-section-heading">
              <span>参考素材</span>
              <small>{selectedReferences.length} / {referenceLimit(model)}</small>
            </div>
            <div className="creation-reference-list">
              {selectedReferences.map((reference, index) => {
                const compatible = modelSupportsReference(model, reference.kind) && index < referenceLimit(model);
                return (
                  <article key={reference.id} className={compatible ? "" : "invalid"}>
                    <span className={`creation-reference-thumb ${reference.kind}`}>
                      {reference.kind === "image" ? <img src={reference.url} alt="" /> : reference.kind === "video" ? "▶" : "♫"}
                    </span>
                    <div><strong>{reference.tag}</strong><small>{reference.name}</small></div>
                    <button type="button" onClick={() => removeReference(reference.id)} aria-label={`移除 ${reference.name}`}>×</button>
                  </article>
                );
              })}
              {!selectedReferences.length && <p>暂无参考素材。输入 <strong>@</strong> 可从素材库选择，也可直接添加本机文件。</p>}
            </div>
            {(invalidReferences.length > 0 || tooManyReferences) && <div className="creation-inline-warning">当前模型不支持其中部分素材，请移除红色项目或切换模型。</div>}
          </div>

          <div className="creation-settings">
            <div className="creation-section-heading"><span>画幅比例</span><small>ASPECT RATIO</small></div>
            <div className="creation-ratio-grid">
              {compatibleRatios(model).map((item) => (
                <button type="button" key={item.value} className={ratio === item.value ? "active" : ""} onClick={() => setRatio(item.value)} disabled={busy || taskActive}>
                  <i className={item.shape} /><span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="creation-setting-grid">
              {modelKind === "image" ? (
                <>
                  <label><span>输出清晰度</span><select value={resolution} onChange={(event) => setResolution(event.target.value as "1K" | "2K" | "4K")} disabled={busy || taskActive}><option value="1K">1K · 快速预览</option><option value="2K">2K · 推荐</option><option value="4K">4K · 精细输出</option></select></label>
                  <label><span>生成质量</span><select value={quality} onChange={(event) => setQuality(event.target.value)} disabled={busy || taskActive}><option value="low">快速</option><option value="medium">标准</option><option value="high">高质量</option></select></label>
                </>
              ) : (
                <>
                  <label><span>视频时长</span><select value={duration} onChange={(event) => setDuration(Number(event.target.value))} disabled={busy || taskActive}>{durationOptions(model).map((seconds) => <option value={seconds} key={seconds}>{seconds} 秒</option>)}</select></label>
                  <label><span>输出规格</span><select value={model === "minimax-h3" ? "768P" : "720P"} disabled><option>{model === "minimax-h3" ? "768P" : "720P"}</option></select></label>
                  {(model === "seedance-2" || model === "seedance-2-5") && <label className="creation-audio-toggle"><span><strong>同步生成声音</strong><small>保留参考音频和环境声描述</small></span><input aria-label="同步生成声音" type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} disabled={busy || taskActive} /></label>}
                </>
              )}
            </div>
          </div>
        </section>

        <aside className="creation-run-panel">
          <div className="creation-panel-title"><span>03</span><div><strong>任务控制</strong><small>GENERATION RUN</small></div></div>
          <div className="creation-run-card">
            <div><span>当前模型</span><strong>{selectedModel.label}</strong></div>
            <div><span>输出</span><strong>{ratio} · {modelKind === "image" ? resolution : `${duration}s`}</strong></div>
            <div><span>参考素材</span><strong>{selectedReferences.length} 个</strong></div>
            <div><span>本次预估</span><strong>{estimate}</strong></div>
          </div>

          {config?.accessTokenRequired && (
            <label className="creation-access-token"><span>工作台访问口令</span><input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder="不是 New.bi API Key" autoComplete="off" /></label>
          )}

          {configLoading && <div className="creation-notice">正在读取 AI 配置…</div>}
          {!configLoading && config?.publicDisabled && <div className="creation-notice warning">公网 AI 接口尚未设置访问保护，已安全停用。</div>}
          {!configLoading && config && !modelAvailable && !config.publicDisabled && <div className="creation-notice warning">{selectedModel.label} 尚未配置服务端密钥。配置完成并重启后即可使用。</div>}

          {(generation || message || error) && (
            <div className={`creation-task-status ${error ? "failure" : generation?.status === "succeeded" ? "success" : ""}`} role="status">
              <span>{error ? "!" : generation?.status === "succeeded" ? "✓" : "↻"}</span>
              <div><strong>{error ? "任务未完成" : generation?.status === "succeeded" ? "生成完成" : "任务处理中"}</strong><p>{error || message}</p>{generation?.taskId && <small>{generation.taskId}</small>}</div>
              {taskActive && <button type="button" onClick={() => setPollingPaused((paused) => !paused)}>{pollingPaused ? "继续" : "暂停"}</button>}
            </div>
          )}

          {savedResults.length > 0 && (
            <div className="creation-result-grid">
              <div className="creation-result-prompt">
                <div><strong>本次生成提示词</strong><span>{submittedPrompt.length} 字符</span></div>
                <p>{submittedPrompt}</p>
                <button type="button" onClick={() => void copyGeneratedPrompt()}>复制提示词</button>
              </div>
              {savedResults.map((result) => (
                <article className={`creation-result-item ${result.saved ? "saved" : "unsaved"}`} key={result.id}>
                  {result.kind === "image"
                    ? <img src={result.url} alt={result.name} />
                    : <video src={result.url} controls><track kind="captions" /></video>}
                  <div className="creation-result-item-footer">
                    <span title={result.name}>{result.name}</span>
                    {result.saved
                      ? <small>已保存到本机素材库</small>
                      : <>
                        <small>{result.saveError || "本地保存失败，结果仍保留在本页"}</small>
                        <button type="button" onClick={() => void retrySaveGeneratedResult(result)}>重试保存</button>
                      </>}
                    <a href={result.url} download={result.name}>下载原文件</a>
                  </div>
                </article>
              ))}
            </div>
          )}

          <button type="button" className="creation-submit" disabled={!canSubmit} onClick={() => void submit()}>
            <span>{busy ? "…" : "✦"}</span>
            {busy ? "处理中" : taskActive ? "任务进行中" : `生成${modelKind === "image" ? "图片" : "视频"}`}
          </button>
          <p className="creation-charge-note">提交后不会自动重新创建任务，避免网络波动造成重复计费。最终费用以 New.bi 账单为准。</p>
          {savedResults.length > 0 && <Link href="/" className="creation-view-library">查看已保存素材 →</Link>}
        </aside>
      </div>
    </main>
  );
}
