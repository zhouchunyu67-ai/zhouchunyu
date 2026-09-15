"use client";

import {
  ChangeEvent,
  type CSSProperties,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
} from "./ai";
import {
  createFrameVaultBackup,
  parseFrameVaultBackup,
  type ParsedFrameVaultBackup,
} from "./backup";
import {
  createEncryptedMigrationPackage,
  parseEncryptedMigrationPackage,
  type ParsedMigrationPackage,
} from "./migration";
import {
  chooseExternalDirectory,
  readExternalWorkspace,
  syncExternalWorkspace,
  verifyExternalDirectoryPermission,
  type VaultDirectoryHandle,
} from "./externalStorage";
import {
  deleteStoredExternalDirectory,
  deleteStoredAsset,
  loadStoredExternalDirectory,
  loadStoredAssets,
  loadStoredPromptState,
  patchStoredAsset,
  restoreStoredWorkspace,
  saveStoredExternalDirectory,
  saveStoredAsset,
  saveStoredPromptState,
  type StoredAssetRecord,
  type StoredExternalDirectory,
  type StoredPromptState,
  type WorkspaceRestoreMode,
} from "./storage";
import {
  promptCategories,
  promptEntries,
  promptKindLabels,
  type PromptKind,
} from "./promptCatalog";

type AssetKind = "image" | "video" | "audio" | "text" | "link";
type AssetCollection = "library" | "category";
type AssetStatus = "reading" | "ready" | "unsupported";
type Filter = "all" | AssetKind | `category:${string}`;
type WorkspaceMode = "assets" | "prompts";
type PromptScope = "category" | "favorites" | "recent";
type BackupDialogMode = "export" | "restore" | null;
type MigrationDialogMode = "export" | "import" | null;
type ExternalStorageStatus = "browser" | "connecting" | "connected" | "permission" | "error";
type PanPoint = { x: number; y: number };
type PanDrag = PanPoint & { panX: number; panY: number };

const AI_MODEL_OPTIONS: Array<{
  id: AiModelId;
  label: string;
  family: string;
  kind: "image" | "video";
  detail: string;
  accent: string;
}> = [
  { id: "gpt-image-2", label: "GPT Image 2", family: "OPENAI IMAGE", kind: "image", detail: "最高 4K · 按次生成", accent: "#f18eae" },
  { id: "seedream-5", label: "Seedream 5.0", family: "DOUBAO IMAGE", kind: "image", detail: "高质感图片 · 按量计费", accent: "#8e9cff" },
  { id: "minimax-h3", label: "MiniMax H3", family: "MINIMAX VIDEO", kind: "video", detail: "768P · 5–15 秒", accent: "#70cabb" },
  { id: "seedance-2", label: "Seedance 2.0", family: "DOUBAO VIDEO", kind: "video", detail: "720P · 4–15 秒", accent: "#f1c46f" },
];

type MediaAsset = {
  id: string;
  file: File;
  url: string;
  thumbnailUrl?: string;
  name: string;
  kind: AssetKind;
  extension: string;
  mime: string;
  size: number;
  textContent?: string;
  linkUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  status: AssetStatus;
  prompt: string;
  category: string;
  collection: AssetCollection;
  createdAt: number;
};

const DEFAULT_ASSET_CATEGORY = "未分类";

function toStoredRecord(asset: MediaAsset): StoredAssetRecord {
  return {
    id: asset.id,
    file: asset.file,
    name: asset.name,
    kind: asset.kind,
    extension: asset.extension,
    mime: asset.mime,
    size: asset.size,
    textContent: asset.textContent,
    linkUrl: asset.linkUrl,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    status: asset.status,
    prompt: asset.prompt,
    category: asset.category,
    collection: asset.collection,
    createdAt: asset.createdAt,
    updatedAt: Date.now(),
  };
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatDuration(seconds = 0) {
  if (!Number.isFinite(seconds)) return "--:--";
  const value = Math.floor(seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function ratioLabel(width?: number, height?: number) {
  if (!width || !height) return "--";
  const commonRatios = [
    { value: 16 / 9, label: "16:9" },
    { value: 9 / 16, label: "9:16" },
    { value: 4 / 3, label: "4:3" },
    { value: 3 / 4, label: "3:4" },
    { value: 1, label: "1:1" },
    { value: 3 / 2, label: "3:2" },
    { value: 2 / 3, label: "2:3" },
    { value: 21 / 9, label: "21:9" },
  ];
  const raw = width / height;
  const common = commonRatios.find((ratio) => Math.abs(raw - ratio.value) < 0.015);
  if (common) return common.label;
  const divisor = gcd(width, height);
  const left = width / divisor;
  const right = height / divisor;
  return left <= 100 && right <= 100 ? `${left}:${right}` : raw.toFixed(2);
}

function orientationLabel(width?: number, height?: number) {
  if (!width || !height) return "识别中";
  if (width === height) return "方形";
  return width > height ? "横向" : "竖向";
}

function resolutionLabel(width?: number, height?: number) {
  if (!width || !height) return "分析中";
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge >= 7680 || shortEdge >= 4320) return "8K";
  if (longEdge >= 3840 || shortEdge >= 2160) return "4K";
  if (longEdge >= 2560 || shortEdge >= 1440) return "2K";
  if (longEdge >= 1920 || shortEdge >= 1080) return "1080P";
  if (longEdge >= 1280 || shortEdge >= 720) return "720P";
  return "标清";
}

function normalizeLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function linkHost(value?: string): string {
  if (!value) return "未填写网址";
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function linkShortcut(value: string): string {
  return `[InternetShortcut]\r\nURL=${value}\r\n`;
}

function externalDirectoryDefaultLabel(name: string): string {
  const trimmed = name.trim();
  return !trimmed || trimmed === "\\" || trimmed === "/"
    ? "磁盘根目录（盘符未公开）"
    : trimmed;
}

function inferKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("text/")) return "text";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif"].includes(extension ?? "")) return "image";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv", "mpeg", "mpg"].includes(extension ?? "")) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus", "wma"].includes(extension ?? "")) return "audio";
  if (["txt", "md", "markdown"].includes(extension ?? "")) return "text";
  return null;
}

function AudioArtwork({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`audio-artwork ${compact ? "compact" : ""}`} aria-hidden="true">
      <span className="audio-disc"><i>♪</i></span>
      <div className="audio-waveform">
        {[34, 58, 82, 48, 72, 96, 64, 42, 78, 54, 88, 38].map((height, index) => (
          <i key={`${height}-${index}`} style={{ height: `${height}%` }} />
        ))}
      </div>
      <small>LOCAL AUDIO</small>
    </div>
  );
}

function LinkArtwork({ url, compact = false }: { url?: string; compact?: boolean }) {
  return (
    <div className={`link-artwork ${compact ? "compact" : ""}`} aria-hidden="true">
      <span>WEB LINK</span>
      <i>↗</i>
      <strong>{linkHost(url)}</strong>
      <small>{url || "等待填写网址"}</small>
    </div>
  );
}

export default function Home() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [viewerZoom, setViewerZoom] = useState(100);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [isLoadingSaved, setIsLoadingSaved] = useState(true);
  const [workspaceMode] = useState<WorkspaceMode>("assets");
  const [promptKind, setPromptKind] = useState<PromptKind>("image");
  const [promptCategoryId, setPromptCategoryId] = useState("portrait-fashion");
  const [promptQuery, setPromptQuery] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState("portrait-fashion-01");
  const [promptScope, setPromptScope] = useState<PromptScope>("category");
  const [promptPage, setPromptPage] = useState(0);
  const [favoritePromptIds, setFavoritePromptIds] = useState<string[]>([]);
  const [recentPromptIds, setRecentPromptIds] = useState<string[]>([]);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [assetCategories, setAssetCategories] = useState<string[]>([DEFAULT_ASSET_CATEGORY]);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categoryPendingDelete, setCategoryPendingDelete] = useState<string | null>(null);
  const [isCategoryBrowserOpen, setIsCategoryBrowserOpen] = useState(false);
  const [categoryBrowserQuery, setCategoryBrowserQuery] = useState("");
  const [isAddingText, setIsAddingText] = useState(false);
  const [textTitleDraft, setTextTitleDraft] = useState("");
  const [textContentDraft, setTextContentDraft] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkTitleDraft, setLinkTitleDraft] = useState("");
  const [linkUrlDraft, setLinkUrlDraft] = useState("");
  const [backupDialogMode, setBackupDialogMode] = useState<BackupDialogMode>(null);
  const [restoreMode, setRestoreMode] = useState<WorkspaceRestoreMode>("merge");
  const [backupCandidate, setBackupCandidate] = useState<ParsedFrameVaultBackup | null>(null);
  const [backupCandidateName, setBackupCandidateName] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupFailure, setBackupFailure] = useState("");
  const [isBackupWorking, setIsBackupWorking] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [migrationDialogMode, setMigrationDialogMode] = useState<MigrationDialogMode>(null);
  const [migrationPassword, setMigrationPassword] = useState("");
  const [migrationPasswordConfirm, setMigrationPasswordConfirm] = useState("");
  const [migrationDevVars, setMigrationDevVars] = useState("");
  const [migrationCandidate, setMigrationCandidate] = useState<ParsedMigrationPackage | null>(null);
  const [migrationCandidateName, setMigrationCandidateName] = useState("");
  const [migrationMessage, setMigrationMessage] = useState("");
  const [migrationFailure, setMigrationFailure] = useState("");
  const [isMigrationWorking, setIsMigrationWorking] = useState(false);
  const migrationInputRef = useRef<HTMLInputElement>(null);
  const [isLocalStatusExpanded, setIsLocalStatusExpanded] = useState(false);
  const [externalDirectory, setExternalDirectory] = useState<StoredExternalDirectory | null>(null);
  const [externalStorageStatus, setExternalStorageStatus] = useState<ExternalStorageStatus>("browser");
  const [externalStorageMessage, setExternalStorageMessage] = useState("");
  const [externalLocationDraft, setExternalLocationDraft] = useState("");
  const [isExternalSyncing, setIsExternalSyncing] = useState(false);
  const [promptStateReady, setPromptStateReady] = useState(false);
  const [previewPan, setPreviewPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [viewerPan, setViewerPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [isPreviewPanning, setIsPreviewPanning] = useState(false);
  const [isViewerPanning, setIsViewerPanning] = useState(false);
  const [isAiStudioOpen, setIsAiStudioOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [aiModel, setAiModel] = useState<AiModelId>("gpt-image-2");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiImageSize, setAiImageSize] = useState("1024x1024");
  const [aiImageQuality, setAiImageQuality] = useState("medium");
  const [aiVideoDuration, setAiVideoDuration] = useState(5);
  const [aiVideoRatio, setAiVideoRatio] = useState("16:9");
  const [aiGenerateAudio, setAiGenerateAudio] = useState(true);
  const [aiAccessToken, setAiAccessToken] = useState("");
  const [aiGeneration, setAiGeneration] = useState<AiGeneration | null>(null);
  const [aiSubmittedPrompt, setAiSubmittedPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiConfigLoading, setAiConfigLoading] = useState(false);
  const [aiPollingPaused, setAiPollingPaused] = useState(false);
  const [aiPollAttempt, setAiPollAttempt] = useState(0);
  const [aiMessage, setAiMessage] = useState("");
  const [aiError, setAiError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const viewerCanvasRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<MediaAsset[]>([]);
  const externalDirectoryRef = useRef<StoredExternalDirectory | null>(null);
  const externalStatusRef = useRef<ExternalStorageStatus>("browser");
  const externalSyncInFlightRef = useRef(false);
  const externalSyncDirtyRef = useRef(false);
  const externalSnapshotRef = useRef<{ records: StoredAssetRecord[]; promptState: StoredPromptState | null }>({ records: [], promptState: null });
  const previewDragRef = useRef<PanDrag | null>(null);
  const viewerDragRef = useRef<PanDrag | null>(null);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    externalDirectoryRef.current = externalDirectory;
  }, [externalDirectory]);

  useEffect(() => {
    externalStatusRef.current = externalStorageStatus;
  }, [externalStorageStatus]);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => {
        if (asset.kind !== "link") URL.revokeObjectURL(asset.url);
        if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl);
      });
    };
  }, []);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  useEffect(() => {
    setZoom(100);
    setViewerZoom(100);
    setPreviewOpen(false);
    setIsRenaming(false);
    setDraftName("");
    setPreviewPan({ x: 0, y: 0 });
    setViewerPan({ x: 0, y: 0 });
  }, [selectedId]);

  useEffect(() => {
    if (zoom <= 100) setPreviewPan({ x: 0, y: 0 });
  }, [zoom]);

  useEffect(() => {
    if (viewerZoom <= 100) setViewerPan({ x: 0, y: 0 });
  }, [viewerZoom]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  useEffect(() => {
    if (!isCategoryBrowserOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsCategoryBrowserOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCategoryBrowserOpen]);

  useEffect(() => {
    if (!isAiStudioOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !aiBusy) setIsAiStudioOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [aiBusy, isAiStudioOpen]);

  useEffect(() => {
    const preview = previewStageRef.current;
    if (!preview) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || selected?.kind !== "image") return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => Math.min(400, Math.max(25, value + (event.deltaY < 0 ? 10 : -10))));
    };
    preview.addEventListener("wheel", onWheel, { passive: false });
    return () => preview.removeEventListener("wheel", onWheel);
  }, [selectedId, selected?.kind]);

  useEffect(() => {
    const canvas = viewerCanvasRef.current;
    if (!canvas || !previewOpen) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || selected?.kind === "text" || selected?.kind === "audio" || selected?.kind === "link") return;
      event.preventDefault();
      event.stopPropagation();
      setViewerZoom((value) => Math.min(400, Math.max(25, value + (event.deltaY < 0 ? 10 : -10))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [previewOpen, selectedId, selected?.kind]);

  const openPreview = () => {
    if (selected?.kind === "link") {
      if (selected.linkUrl) window.open(selected.linkUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setViewerZoom(100);
    setViewerPan({ x: 0, y: 0 });
    setPreviewOpen(true);
  };

  const beginPan = (
    event: ReactPointerEvent<HTMLDivElement>,
    area: "preview" | "viewer",
  ) => {
    if (event.button !== 0 || selected?.kind !== "image") return;
    const activeZoom = area === "preview" ? zoom : viewerZoom;
    if (activeZoom <= 100) return;
    const point = area === "preview" ? previewPan : viewerPan;
    const drag = { x: event.clientX, y: event.clientY, panX: point.x, panY: point.y };
    if (area === "preview") {
      previewDragRef.current = drag;
      setIsPreviewPanning(true);
    } else {
      viewerDragRef.current = drag;
      setIsViewerPanning(true);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const movePan = (
    event: ReactPointerEvent<HTMLDivElement>,
    area: "preview" | "viewer",
  ) => {
    const drag = area === "preview" ? previewDragRef.current : viewerDragRef.current;
    if (!drag) return;
    const activeZoom = area === "preview" ? zoom : viewerZoom;
    const maxX = Math.max(48, event.currentTarget.clientWidth * (activeZoom / 100 - 1) / 2 + 48);
    const maxY = Math.max(48, event.currentTarget.clientHeight * (activeZoom / 100 - 1) / 2 + 48);
    const next = {
      x: Math.max(-maxX, Math.min(maxX, drag.panX + event.clientX - drag.x)),
      y: Math.max(-maxY, Math.min(maxY, drag.panY + event.clientY - drag.y)),
    };
    if (area === "preview") setPreviewPan(next);
    else setViewerPan(next);
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>, area: "preview" | "viewer") => {
    if (area === "preview") {
      previewDragRef.current = null;
      setIsPreviewPanning(false);
    } else {
      viewerDragRef.current = null;
      setIsViewerPanning(false);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const updateAsset = useCallback((id: string, values: Partial<MediaAsset>) => {
    setAssets((current) => current.map((asset) => (asset.id === id ? { ...asset, ...values } : asset)));
    const persistentValues: Partial<Omit<StoredAssetRecord, "id" | "file" | "createdAt">> = {};
    if ("name" in values) persistentValues.name = values.name;
    if ("prompt" in values) persistentValues.prompt = values.prompt;
    if ("category" in values) persistentValues.category = values.category;
    if ("collection" in values && values.collection) persistentValues.collection = values.collection;
    if ("textContent" in values) persistentValues.textContent = values.textContent;
    if ("linkUrl" in values) persistentValues.linkUrl = values.linkUrl;
    if ("size" in values) persistentValues.size = values.size;
    if ("width" in values) persistentValues.width = values.width;
    if ("height" in values) persistentValues.height = values.height;
    if ("duration" in values) persistentValues.duration = values.duration;
    if ("status" in values && values.status) persistentValues.status = values.status;
    if (Object.keys(persistentValues).length) {
      void patchStoredAsset(id, persistentValues).catch(() => {
        setNotice("本地保存暂时失败，请检查浏览器存储空间");
      });
    }
  }, []);

  const readMetadata = useCallback((asset: MediaAsset) => {
    if (asset.kind === "link") {
      updateAsset(asset.id, { status: asset.linkUrl ? "ready" : "unsupported" });
      return;
    }
    if (asset.kind === "text") {
      if (asset.textContent !== undefined) {
        updateAsset(asset.id, { status: "ready" });
        return;
      }
      void asset.file.text()
        .then((textContent) => updateAsset(asset.id, { textContent, status: "ready" }))
        .catch(() => updateAsset(asset.id, { status: "unsupported" }));
      return;
    }
    if (asset.kind === "image") {
      const image = new Image();
      image.onload = () => updateAsset(asset.id, {
        width: image.naturalWidth,
        height: image.naturalHeight,
        status: "ready",
      });
      image.onerror = () => updateAsset(asset.id, { status: "unsupported" });
      image.src = asset.url;
      return;
    }

    if (asset.kind === "audio") {
      const audio = document.createElement("audio");
      audio.preload = "metadata";
      const releaseAudio = () => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.removeAttribute("src");
        audio.load();
      };
      audio.onloadedmetadata = () => {
        updateAsset(asset.id, {
          duration: audio.duration,
          status: "ready",
        });
        releaseAudio();
      };
      audio.onerror = () => {
        updateAsset(asset.id, { status: "unsupported" });
        releaseAudio();
      };
      audio.src = asset.url;
      audio.load();
      return;
    }

    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const releaseVideo = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };

    const captureThumbnail = () => {
      try {
        const maxWidth = 480;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          releaseVideo();
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            const thumbnailUrl = URL.createObjectURL(blob);
            setAssets((current) => {
              let found = false;
              const next = current.map((item) => {
                if (item.id !== asset.id) return item;
                found = true;
                if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
                return { ...item, thumbnailUrl };
              });
              if (!found) URL.revokeObjectURL(thumbnailUrl);
              return next;
            });
          }
          releaseVideo();
        }, "image/jpeg", 0.8);
      } catch {
        releaseVideo();
      }
    };

    video.onloadedmetadata = () => {
      updateAsset(asset.id, {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        status: "ready",
      });
      const targetTime = Number.isFinite(video.duration) && video.duration > 0.25
        ? Math.min(0.35, video.duration * 0.2)
        : 0;
      if (targetTime > 0) video.currentTime = targetTime;
      else captureThumbnail();
    };
    video.onseeked = captureThumbnail;
    video.onerror = () => {
      updateAsset(asset.id, { status: "unsupported" });
      releaseVideo();
    };
    video.src = asset.url;
    video.load();
  }, [updateAsset]);

  const syncVideoMetadata = useCallback((id: string, video: HTMLVideoElement) => {
    if (!video.videoWidth || !video.videoHeight) return;
    updateAsset(id, {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      status: "ready",
    });
  }, [updateAsset]);

  const syncAudioMetadata = useCallback((id: string, audio: HTMLAudioElement) => {
    if (!Number.isFinite(audio.duration)) return;
    updateAsset(id, {
      duration: audio.duration,
      status: "ready",
    });
  }, [updateAsset]);

  useEffect(() => {
    let active = true;
    void loadStoredAssets()
      .then((records) => {
        if (!active) return;
        const restored: MediaAsset[] = records.map((record) => {
          const file = record.file instanceof File
            ? record.file
            : new File([record.file], record.name, { type: record.mime });
          return {
            id: record.id,
            file,
            url: record.kind === "link" ? record.linkUrl ?? "" : URL.createObjectURL(file),
            name: record.name,
            kind: record.kind,
            extension: record.extension,
            mime: record.mime,
            size: record.size,
            textContent: record.textContent,
            linkUrl: record.linkUrl,
            width: record.width,
            height: record.height,
            duration: record.duration,
            status: record.status,
            prompt: record.prompt,
            category: record.category ?? DEFAULT_ASSET_CATEGORY,
            collection: record.collection ?? "category",
            createdAt: record.createdAt,
          };
        });
        setAssets(restored);
        setSelectedId(restored.find((asset) => asset.collection === "library")?.id ?? null);
        setIsLoadingSaved(false);
        restored.forEach(readMetadata);
      })
      .catch(() => {
        if (!active) return;
        setIsLoadingSaved(false);
        setNotice("无法读取本机素材库，请检查浏览器存储权限");
      });
    return () => { active = false; };
  }, [readMetadata]);

  useEffect(() => {
    let active = true;
    void loadStoredPromptState()
      .then((state) => {
        if (!active) return;
        if (state) {
          setFavoritePromptIds(state.favorites ?? []);
          setRecentPromptIds(state.recent ?? []);
          setPromptDrafts(state.drafts ?? {});
          setAssetCategories(Array.from(new Set([DEFAULT_ASSET_CATEGORY, ...(state.assetCategories ?? [])])));
        }
        setPromptStateReady(true);
      })
      .catch(() => {
        if (!active) return;
        setPromptStateReady(true);
        setNotice("提示词个人记录读取失败");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!promptStateReady) return;
    const timer = window.setTimeout(() => {
      void saveStoredPromptState({
        favorites: favoritePromptIds,
        recent: recentPromptIds,
        drafts: promptDrafts,
        assetCategories,
      }).catch(() => setNotice("提示词个人记录保存失败"));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [assetCategories, favoritePromptIds, promptDrafts, promptStateReady, recentPromptIds]);

  useEffect(() => {
    let active = true;
    void loadStoredExternalDirectory()
      .then(async (record) => {
        if (!active || !record) return;
        externalDirectoryRef.current = record;
        setExternalDirectory(record);
        setExternalLocationDraft(record.locationLabel ?? externalDirectoryDefaultLabel(record.name));
        const granted = await verifyExternalDirectoryPermission(record.handle, false);
        if (!active) return;
        if (granted) {
          const externalWorkspace = await readExternalWorkspace(record.handle);
          if (!active) return;
          if (externalWorkspace && record.lastSyncedAt && externalWorkspace.updatedAt > record.lastSyncedAt) {
            const result = await restoreStoredWorkspace(externalWorkspace.records, externalWorkspace.promptState, "merge");
            setExternalStorageMessage(`已从外部目录合并 ${result.imported} 个素材，本机已有素材保留`);
            await saveStoredExternalDirectory(record.handle, externalWorkspace.updatedAt, record.locationLabel);
            window.location.reload();
            return;
          }
        }
        const status: ExternalStorageStatus = granted ? "connected" : "permission";
        externalStatusRef.current = status;
        setExternalStorageStatus(status);
        const locationLabel = record.locationLabel ?? externalDirectoryDefaultLabel(record.name);
        setExternalStorageMessage(granted ? `已连接：${locationLabel}` : `需要重新授权：${locationLabel}`);
      })
      .catch(() => {
        if (!active) return;
        externalStatusRef.current = "error";
        setExternalStorageStatus("error");
        setExternalStorageMessage("外部目录记录读取失败，可重新选择目录");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    externalSnapshotRef.current = {
      records: assets.map(toStoredRecord),
      promptState: promptStateReady ? {
        id: "workspace",
        favorites: favoritePromptIds,
        recent: recentPromptIds,
        drafts: promptDrafts,
        assetCategories,
        updatedAt: Date.now(),
      } : null,
    };
  }, [assetCategories, assets, favoritePromptIds, promptDrafts, promptStateReady, recentPromptIds]);

  const flushExternalSync = useCallback(async (manual = false) => {
    const directory = externalDirectoryRef.current;
    if (!directory || externalStatusRef.current !== "connected") return;
    externalSyncDirtyRef.current = true;
    if (externalSyncInFlightRef.current) return;
    externalSyncInFlightRef.current = true;
    setIsExternalSyncing(true);
    try {
      let lastResult = { written: 0, reused: 0, removed: 0, updatedAt: 0 };
      while (externalSyncDirtyRef.current) {
        externalSyncDirtyRef.current = false;
        const snapshot = externalSnapshotRef.current;
        lastResult = await syncExternalWorkspace(directory.handle, snapshot.records, snapshot.promptState);
      }
      const nextDirectory = { ...directory, lastSyncedAt: lastResult.updatedAt, updatedAt: Date.now() };
      await saveStoredExternalDirectory(directory.handle, lastResult.updatedAt, directory.locationLabel);
      externalDirectoryRef.current = nextDirectory;
      setExternalDirectory(nextDirectory);
      setExternalStorageMessage(manual
        ? `同步完成：写入 ${lastResult.written} 个，复用 ${lastResult.reused} 个`
        : `已同步：${directory.locationLabel ?? externalDirectoryDefaultLabel(directory.name)}`);
    } catch (error) {
      externalStatusRef.current = "error";
      setExternalStorageStatus("error");
      setExternalStorageMessage(error instanceof Error ? error.message : "外部目录同步失败，请重新连接");
    } finally {
      externalSyncInFlightRef.current = false;
      setIsExternalSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (externalStorageStatus !== "connected" || isLoadingSaved || !promptStateReady) return;
    externalSyncDirtyRef.current = true;
    const timer = window.setTimeout(() => void flushExternalSync(false), 850);
    return () => window.clearTimeout(timer);
  }, [assets, assetCategories, externalStorageStatus, favoritePromptIds, flushExternalSync, isLoadingSaved, promptDrafts, promptStateReady, recentPromptIds]);

  const connectExternalFolder = async (existingHandle?: VaultDirectoryHandle) => {
    const previousDirectory = externalDirectoryRef.current;
    const previousStatus = externalStatusRef.current;
    externalStatusRef.current = "connecting";
    setExternalStorageStatus("connecting");
    setExternalStorageMessage(existingHandle ? "正在重新连接素材目录…" : "请选择硬盘或 U 盘中的素材目录…");
    try {
      const handle = existingHandle ?? await chooseExternalDirectory();
      if (!await verifyExternalDirectoryPermission(handle, true)) throw new Error("未获得该文件夹的读写权限");
      const locationLabel = previousDirectory?.locationLabel ?? externalDirectoryDefaultLabel(handle.name);
      if (existingHandle) {
        const externalWorkspace = await readExternalWorkspace(handle);
        if (externalWorkspace && previousDirectory?.lastSyncedAt && externalWorkspace.updatedAt > previousDirectory.lastSyncedAt) {
          setExternalStorageMessage(`检测到“${handle.name}”在其他设备上有更新，正在载入…`);
          const result = await restoreStoredWorkspace(externalWorkspace.records, externalWorkspace.promptState, "merge");
          setExternalStorageMessage(`已从外部目录合并 ${result.imported} 个素材，本机已有素材保留`);
          await saveStoredExternalDirectory(handle, externalWorkspace.updatedAt, locationLabel);
          window.location.reload();
          return;
        }
        const snapshot = externalSnapshotRef.current;
        setExternalStorageMessage(`正在把本机待同步内容写入“${handle.name}”…`);
        const result = await syncExternalWorkspace(handle, snapshot.records, snapshot.promptState);
        const record: StoredExternalDirectory = {
          id: "external-directory",
          handle,
          name: handle.name,
          locationLabel,
          lastSyncedAt: result.updatedAt,
          updatedAt: Date.now(),
        };
        await saveStoredExternalDirectory(handle, result.updatedAt, locationLabel);
        externalDirectoryRef.current = record;
        externalStatusRef.current = "connected";
        setExternalDirectory(record);
        setExternalLocationDraft(locationLabel);
        setExternalStorageStatus("connected");
        setExternalStorageMessage(`重新连接完成：写入 ${result.written} 个，清理 ${result.removed} 个`);
        return;
      }
      const externalWorkspace = await readExternalWorkspace(handle);
      if (externalWorkspace) {
        setExternalStorageMessage(`正在读取“${handle.name}”中的 ${externalWorkspace.records.length} 个素材…`);
        await restoreStoredWorkspace(externalWorkspace.records, externalWorkspace.promptState, "merge");
        await saveStoredExternalDirectory(handle, externalWorkspace.updatedAt, locationLabel);
        window.location.reload();
        return;
      }

      const snapshot = externalSnapshotRef.current;
      setExternalStorageMessage(`正在迁移 ${snapshot.records.length} 个现有素材，请勿拔出存储设备…`);
      const result = await syncExternalWorkspace(handle, snapshot.records, snapshot.promptState);
      const record: StoredExternalDirectory = {
        id: "external-directory",
        handle,
        name: handle.name,
        locationLabel,
        lastSyncedAt: result.updatedAt,
        updatedAt: Date.now(),
      };
      await saveStoredExternalDirectory(handle, result.updatedAt, locationLabel);
      externalDirectoryRef.current = record;
      externalStatusRef.current = "connected";
      setExternalDirectory(record);
      setExternalLocationDraft(locationLabel);
      setExternalStorageStatus("connected");
      setExternalStorageMessage(`目录已启用：写入 ${result.written} 个素材，浏览器副本已保留`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        externalDirectoryRef.current = previousDirectory;
        externalStatusRef.current = previousStatus;
        setExternalDirectory(previousDirectory);
        setExternalStorageStatus(previousStatus);
        setExternalStorageMessage(previousDirectory ? `仍使用：${previousDirectory.locationLabel ?? externalDirectoryDefaultLabel(previousDirectory.name)}` : "已取消选择，继续使用浏览器本地存储");
        return;
      }
      externalStatusRef.current = previousDirectory ? "error" : "browser";
      setExternalStorageStatus(previousDirectory ? "error" : "browser");
      setExternalStorageMessage(error instanceof Error ? error.message : "外部目录连接失败");
    }
  };

  const stopUsingExternalFolder = async () => {
    try {
      await deleteStoredExternalDirectory();
      externalDirectoryRef.current = null;
      externalStatusRef.current = "browser";
      externalSyncDirtyRef.current = false;
      setExternalDirectory(null);
      setExternalStorageStatus("browser");
      setExternalLocationDraft("");
      setExternalStorageMessage("已停止同步，外部目录中的文件未删除");
    } catch {
      setExternalStorageMessage("无法停用外部目录，请重试");
    }
  };

  const saveExternalLocationLabel = async () => {
    const directory = externalDirectoryRef.current;
    if (!directory) return;
    const locationLabel = externalLocationDraft.trim().slice(0, 60) || externalDirectoryDefaultLabel(directory.name);
    const nextDirectory = { ...directory, locationLabel, updatedAt: Date.now() };
    try {
      await saveStoredExternalDirectory(directory.handle, directory.lastSyncedAt, locationLabel);
      externalDirectoryRef.current = nextDirectory;
      setExternalDirectory(nextDirectory);
      setExternalLocationDraft(locationLabel);
      setExternalStorageMessage(`同步位置已标记为：${locationLabel}`);
    } catch {
      setExternalStorageMessage("同步位置标记保存失败，请重试");
    }
  };

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: MediaAsset[] = [];
    const activeCollection: AssetCollection = filter.startsWith("category:") ? "category" : "library";
    const activeCategory = filter.startsWith("category:")
      ? filter.slice("category:".length)
      : DEFAULT_ASSET_CATEGORY;
    let skipped = 0;
    Array.from(files).forEach((file) => {
      const kind = inferKind(file);
      const typedFilter = filter === "image" || filter === "video" || filter === "audio" || filter === "text" || filter === "link" ? filter : null;
      if (!kind || (typedFilter && kind !== typedFilter)) {
        skipped += 1;
        return;
      }
      const extension = file.name.includes(".")
        ? file.name.split(".").pop()?.toUpperCase() ?? "未知"
        : "未知";
      accepted.push({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        kind,
        extension,
        mime: file.type || "未知格式",
        size: file.size,
        status: "reading",
        prompt: "",
        category: activeCategory,
        collection: activeCollection,
        createdAt: Date.now() + accepted.length,
      });
    });

    if (accepted.length) {
      setAssets((current) => [...accepted, ...current]);
      setQuery("");
      setSelectedId(accepted[0].id);
      setNotice(activeCategory === DEFAULT_ASSET_CATEGORY
        ? `已导入 ${accepted.length} 个素材`
        : `已导入 ${accepted.length} 个素材到“${activeCategory}”`);
      window.setTimeout(() => setNotice(""), 1800);
      accepted.forEach((asset) => {
        void saveStoredAsset(toStoredRecord(asset))
          .then(() => readMetadata(asset))
          .catch(() => setNotice("素材保存失败，请检查浏览器存储空间"));
      });
    }
    if (skipped) {
      setNotice(`已忽略 ${skipped} 个不支持的文件`);
      window.setTimeout(() => setNotice(""), 3200);
    }
  }, [filter, readMetadata]);

  const openAiStudio = async () => {
    const preferredModel: AiModelId = selected?.kind === "video" || filter === "video" ? "minimax-h3" : "gpt-image-2";
    const savedToken = window.sessionStorage.getItem("frame-vault-ai-access-token");
    if (!aiAccessToken && savedToken) setAiAccessToken(savedToken);
    setAiModel(preferredModel);
    if (selected?.prompt.trim()) setAiPrompt(selected.prompt.trim());
    setAiError("");
    setAiMessage("");
    setIsAiStudioOpen(true);
    setAiConfigLoading(true);
    try {
      const config = await loadAiConfig();
      setAiConfig(config);
      const preferredAvailable = config.models.some((model) => model.id === preferredModel && model.available);
      const firstAvailable = config.models.find((model) => model.available);
      if (!preferredAvailable && firstAvailable) setAiModel(firstAvailable.id);
    } catch {
      setAiConfig(null);
      setAiError("无法读取 AI 服务配置，请确认本地服务仍在运行。");
    } finally {
      setAiConfigLoading(false);
    }
  };

  const storeAiAssets = useCallback(async (
    generatedAssets: AiGeneratedAsset[],
    prompt: string,
    accessToken: string,
  ) => {
    if (!generatedAssets.length) throw new AiRequestError("任务完成但没有可保存的素材。", "EMPTY_RESULT");
    const files = await Promise.all(generatedAssets.map((asset) => downloadAiAsset(asset, accessToken)));
    const now = Date.now();
    const imported = files.map((file, index) => {
      const kind = inferKind(file);
      if (kind !== "image" && kind !== "video") throw new AiRequestError("生成结果不是受支持的图片或视频。", "UNSUPPORTED_RESULT");
      return {
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        kind,
        extension: file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() ?? "AI" : "AI",
        mime: file.type || (kind === "image" ? "image/webp" : "video/mp4"),
        size: file.size,
        status: "reading" as const,
        prompt,
        category: DEFAULT_ASSET_CATEGORY,
        collection: "library" as const,
        createdAt: now + index,
      } satisfies MediaAsset;
    });

    setAssets((current) => [...imported, ...current]);
    setFilter("all");
    setQuery("");
    setSelectedId(imported[0].id);
    await Promise.all(imported.map((asset) => saveStoredAsset(toStoredRecord(asset))));
    imported.forEach((asset) => readMetadata(asset));
    setNotice(`AI 生成完成，已加入素材库 ${imported.length} 个素材`);
    window.setTimeout(() => setNotice(""), 3200);
  }, [readMetadata]);

  const submitAiGeneration = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setAiError("请先输入生成提示词。");
      return;
    }
    const option = AI_MODEL_OPTIONS.find((item) => item.id === aiModel)!;
    setAiBusy(true);
    setAiError("");
    setAiMessage(option.kind === "video" ? "正在提交视频任务，请勿重复点击…" : "正在生成图片，请勿关闭页面…");
    setAiGeneration(null);
    setAiSubmittedPrompt(prompt);
    setAiPollingPaused(false);
    setAiPollAttempt(0);
    if (aiAccessToken) window.sessionStorage.setItem("frame-vault-ai-access-token", aiAccessToken);

    try {
      const generation = await createAiGeneration({
        model: aiModel,
        prompt,
        parameters: option.kind === "image"
          ? { size: aiImageSize, quality: aiImageQuality, format: "webp" }
          : { duration: aiVideoDuration, ratio: aiVideoRatio, generateAudio: aiGenerateAudio },
      }, aiAccessToken);
      setAiGeneration(generation);
      if (generation.status === "succeeded" && generation.assets?.length) {
        setAiMessage("生成成功，正在写入本地素材库…");
        await storeAiAssets(generation.assets, prompt, aiAccessToken);
        setAiMessage("已保存到本机素材库。你可以关闭窗口查看。 ");
      } else if (generation.taskId) {
        setAiMessage("任务已提交，工作台会自动查询生成进度。");
      } else {
        throw new AiRequestError("服务没有返回可查询的任务编号。", "MISSING_TASK_ID");
      }
    } catch (error) {
      setAiGeneration(null);
      setAiError(error instanceof Error ? error.message : "生成请求失败，请稍后重试。");
      setAiMessage("");
    } finally {
      setAiBusy(false);
    }
  };

  useEffect(() => {
    if (!isAiStudioOpen || aiPollingPaused || !aiGeneration?.taskId) return;
    if (aiGeneration.status === "succeeded" || aiGeneration.status === "failed") return;
    const reachedPollingLimit = aiPollAttempt >= 80;
    const delay = reachedPollingLimit ? 0 : Math.min(15_000, 3_000 + aiPollAttempt * 1_500);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (reachedPollingLimit) {
        setAiPollingPaused(true);
        setAiError("任务查询已持续约 20 分钟，已暂停自动查询。任务可能仍在 New.bi 继续运行。");
        return;
      }
      void queryAiGeneration(aiGeneration.model, aiGeneration.taskId!, aiAccessToken)
        .then(async (generation) => {
          if (cancelled) return;
          if (generation.status === "succeeded" && generation.assets?.length) {
            setAiBusy(true);
            setAiMessage("视频生成完成，正在下载到本机素材库…");
            try {
              await storeAiAssets(generation.assets, aiSubmittedPrompt, aiAccessToken);
              if (cancelled) return;
              setAiGeneration(generation);
              setAiMessage("视频已保存到本机素材库。你可以关闭窗口查看。");
            } catch (error) {
              if (cancelled) return;
              setAiGeneration(generation);
              setAiError(error instanceof Error ? `视频已生成，但写入本地素材库失败：${error.message}` : "视频已生成，但写入本地素材库失败。");
              setAiMessage("");
            } finally {
              if (!cancelled) setAiBusy(false);
            }
          } else if (generation.status === "failed") {
            setAiGeneration(generation);
            setAiError("上游任务生成失败。请在 New.bi 任务日志中查看详细原因。");
            setAiMessage("");
          } else {
            setAiGeneration(generation);
            setAiMessage(generation.status === "queued" ? "任务仍在队列中…" : "正在生成视频…");
            setAiPollAttempt((attempt) => attempt + 1);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          const requestError = error instanceof AiRequestError ? error : null;
          if (requestError && [401, 403, 503].includes(requestError.status)) {
            setAiPollingPaused(true);
            setAiError(requestError.message);
            setAiMessage("");
            return;
          }
          setAiMessage("暂时无法查询进度，稍后会自动再试…");
          setAiPollAttempt((attempt) => attempt + 1);
        });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiAccessToken, aiGeneration, aiPollAttempt, aiPollingPaused, aiSubmittedPrompt, isAiStudioOpen, storeAiAssets]);

  const addTextAsset = () => {
    const textContent = textContentDraft.trim();
    if (!textContent) return;
    const activeCategory = filter.startsWith("category:")
      ? filter.slice("category:".length)
      : DEFAULT_ASSET_CATEGORY;
    const activeCollection: AssetCollection = filter.startsWith("category:") ? "category" : "library";
    const rawTitle = textTitleDraft.trim() || `文本素材 ${assets.filter((asset) => asset.kind === "text").length + 1}`;
    const name = /\.(txt|md)$/i.test(rawTitle) ? rawTitle : `${rawTitle}.txt`;
    const file = new File([textContent], name, { type: "text/plain;charset=utf-8" });
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      file,
      url: URL.createObjectURL(file),
      name,
      kind: "text",
      extension: name.toLowerCase().endsWith(".md") ? "MD" : "TXT",
      mime: file.type,
      size: file.size,
      textContent,
      status: "ready",
      prompt: "",
      category: activeCategory,
      collection: activeCollection,
      createdAt: Date.now(),
    };
    setAssets((current) => [asset, ...current]);
    setQuery("");
    setSelectedId(asset.id);
    setTextTitleDraft("");
    setTextContentDraft("");
    setIsAddingText(false);
    setNotice(activeCategory === DEFAULT_ASSET_CATEGORY
      ? "已添加文本素材"
      : `已添加文本素材到“${activeCategory}”`);
    window.setTimeout(() => setNotice(""), 1800);
    void saveStoredAsset(toStoredRecord(asset))
      .catch(() => setNotice("文本保存失败，请检查浏览器存储空间"));
  };

  const addLinkAsset = () => {
    const linkUrl = normalizeLinkUrl(linkUrlDraft);
    if (!linkUrl) {
      setNotice("请输入有效的 http 或 https 链接");
      window.setTimeout(() => setNotice(""), 2400);
      return;
    }
    const activeCategory = filter.startsWith("category:")
      ? filter.slice("category:".length)
      : DEFAULT_ASSET_CATEGORY;
    const activeCollection: AssetCollection = filter.startsWith("category:") ? "category" : "library";
    const name = linkTitleDraft.trim() || linkHost(linkUrl);
    const shortcut = linkShortcut(linkUrl);
    const file = new File([shortcut], `${name}.url`, { type: "text/uri-list" });
    const asset: MediaAsset = {
      id: crypto.randomUUID(),
      file,
      url: linkUrl,
      name,
      kind: "link",
      extension: "LINK",
      mime: file.type,
      size: file.size,
      textContent: "",
      linkUrl,
      status: "ready",
      prompt: "",
      category: activeCategory,
      collection: activeCollection,
      createdAt: Date.now(),
    };
    setAssets((current) => [asset, ...current]);
    setQuery("");
    setSelectedId(asset.id);
    setLinkTitleDraft("");
    setLinkUrlDraft("");
    setIsAddingLink(false);
    setNotice(activeCategory === DEFAULT_ASSET_CATEGORY
      ? "已添加链接素材"
      : `已添加链接素材到“${activeCategory}”`);
    window.setTimeout(() => setNotice(""), 1800);
    void saveStoredAsset(toStoredRecord(asset))
      .catch(() => setNotice("链接保存失败，请检查浏览器存储空间"));
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const removeAsset = (id: string) => {
    setAssets((current) => {
      const target = current.find((asset) => asset.id === id);
      if (target) {
        if (target.kind !== "link") URL.revokeObjectURL(target.url);
        if (target.thumbnailUrl) URL.revokeObjectURL(target.thumbnailUrl);
      }
      const remaining = current.filter((asset) => asset.id !== id);
      if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
      return remaining;
    });
    void deleteStoredAsset(id).catch(() => setNotice("本地记录删除失败，请重试"));
  };

  const updatePrompt = (prompt: string) => {
    if (selectedId) updateAsset(selectedId, { prompt });
  };

  const copySelectedText = async () => {
    if (!selected || selected.kind !== "text") return;
    try {
      await navigator.clipboard.writeText(selected.textContent ?? "");
      setNotice("文本内容已复制");
      window.setTimeout(() => setNotice(""), 1600);
    } catch {
      setNotice("复制失败，请在文本框中手动复制");
    }
  };

  const moveSelectedAsset = (destination: string) => {
    if (!selected) return;
    if (destination === "__library__") {
      updateAsset(selected.id, { collection: "library" });
      setNotice(`已将“${selected.name}”移到素材库根目录`);
    } else {
      updateAsset(selected.id, { collection: "category", category: destination });
      setNotice(`已将“${selected.name}”移到“${destination}”`);
    }
    window.setTimeout(() => setNotice(""), 1800);
  };

  const saveName = () => {
    const value = draftName.trim();
    if (selectedId && value) updateAsset(selectedId, { name: value });
    setIsRenaming(false);
  };

  const addAssetCategory = () => {
    const value = categoryDraft.trim().slice(0, 24);
    if (!value) return;
    if (!assetCategories.includes(value)) {
      setAssetCategories((current) => [...current, value]);
      setNotice(`已添加类目：${value}`);
      window.setTimeout(() => setNotice(""), 1600);
    }
    setFilter(`category:${value}`);
    setCategoryDraft("");
    setIsAddingCategory(false);
  };

  const deleteAssetCategory = () => {
    const category = categoryPendingDelete;
    if (!category || category === DEFAULT_ASSET_CATEGORY) return;
    const affectedAssets = assets.filter((asset) => asset.collection === "category" && asset.category === category);
    setAssets((current) => current.map((asset) => (
      asset.collection === "category" && asset.category === category
        ? { ...asset, category: DEFAULT_ASSET_CATEGORY }
        : asset
    )));
    setAssetCategories((current) => current.filter((item) => item !== category));
    if (filter === `category:${category}`) setFilter(`category:${DEFAULT_ASSET_CATEGORY}`);
    setCategoryPendingDelete(null);
    void Promise.all(affectedAssets.map((asset) => patchStoredAsset(asset.id, { category: DEFAULT_ASSET_CATEGORY })))
      .then(() => {
        setNotice(affectedAssets.length
          ? `已删除“${category}”，${affectedAssets.length} 个素材已移到未分类`
          : `已删除类目“${category}”`);
        window.setTimeout(() => setNotice(""), 2400);
      })
      .catch(() => setNotice("类目已删除，但部分素材的归类保存失败，请重试"));
  };

  const openBackupDialog = (mode: Exclude<BackupDialogMode, null>) => {
    setBackupDialogMode(mode);
    setRestoreMode("merge");
    setBackupCandidate(null);
    setBackupCandidateName("");
    setBackupMessage("");
    setBackupFailure("");
    setReplaceConfirmed(false);
  };

  const closeBackupDialog = () => {
    if (isBackupWorking) return;
    setBackupDialogMode(null);
    setBackupCandidate(null);
    setBackupCandidateName("");
    setBackupMessage("");
    setBackupFailure("");
    setReplaceConfirmed(false);
    if (backupInputRef.current) backupInputRef.current.value = "";
  };

  const openMigrationDialog = (mode: Exclude<MigrationDialogMode, null>) => {
    setMigrationDialogMode(mode);
    setMigrationPassword("");
    setMigrationPasswordConfirm("");
    setMigrationDevVars("");
    setMigrationCandidate(null);
    setMigrationCandidateName("");
    setMigrationMessage("");
    setMigrationFailure("");
  };

  const closeMigrationDialog = () => {
    if (isMigrationWorking) return;
    setMigrationDialogMode(null);
    setMigrationPassword("");
    setMigrationPasswordConfirm("");
    setMigrationDevVars("");
    setMigrationCandidate(null);
    setMigrationCandidateName("");
    setMigrationMessage("");
    setMigrationFailure("");
    if (migrationInputRef.current) migrationInputRef.current.value = "";
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const exportEncryptedMigration = async () => {
    if (migrationPassword.length < 8) {
      setMigrationFailure("迁移密码至少需要 8 个字符。");
      return;
    }
    if (migrationPassword !== migrationPasswordConfirm) {
      setMigrationFailure("两次输入的迁移密码不一致。");
      return;
    }
    if (!migrationDevVars.trim()) {
      setMigrationFailure("请粘贴 .dev.vars 内容；密钥只会在本机加密，不会上传。");
      return;
    }
    setIsMigrationWorking(true);
    setMigrationFailure("");
    setMigrationMessage("正在加密素材和配置，请稍候…");
    try {
      const records = assets.map((asset) => {
        const record = toStoredRecord(asset);
        if (asset.kind !== "text") return record;
        const file = new Blob([asset.textContent ?? ""], { type: asset.mime || "text/plain;charset=utf-8" });
        return { ...record, file, size: file.size };
      });
      const promptState: StoredPromptState = {
        id: "workspace",
        favorites: favoritePromptIds,
        recent: recentPromptIds,
        drafts: promptDrafts,
        assetCategories,
        updatedAt: Date.now(),
      };
      const result = await createEncryptedMigrationPackage(records, promptState, migrationDevVars, migrationPassword);
      const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "_");
      downloadBlob(result.blob, `FrameVault-Migration-${timestamp}.framevault-migration`);
      setMigrationMessage(`已生成加密迁移包：${result.assetCount} 个素材，共 ${formatBytes(result.totalBytes)}。请妥善保存迁移密码。`);
    } catch (error) {
      setMigrationMessage("");
      setMigrationFailure(error instanceof Error ? error.message : "迁移包生成失败，请重试。");
    } finally {
      setIsMigrationWorking(false);
    }
  };

  const prepareMigrationFile = async (file?: File) => {
    if (!file) return;
    setIsMigrationWorking(true);
    setMigrationCandidate(null);
    setMigrationCandidateName(file.name);
    setMigrationFailure("");
    setMigrationMessage("正在解密并校验迁移包…");
    try {
      const parsed = await parseEncryptedMigrationPackage(file, migrationPassword);
      setMigrationCandidate(parsed);
      setMigrationDevVars(parsed.devVars);
      setMigrationMessage(`解密完成：${parsed.backup.manifest.assetCount} 个素材，共 ${formatBytes(parsed.backup.manifest.totalBytes)}。`);
    } catch (error) {
      setMigrationMessage("");
      setMigrationFailure(error instanceof Error ? error.message : "无法读取这个加密迁移包。");
    } finally {
      setIsMigrationWorking(false);
    }
  };

  const restoreEncryptedMigration = async () => {
    if (!migrationCandidate) return;
    setIsMigrationWorking(true);
    setMigrationFailure("");
    setMigrationMessage("正在恢复素材库…");
    try {
      const result = await restoreStoredWorkspace(migrationCandidate.backup.assets, migrationCandidate.backup.promptState, "merge");
      const envBlob = new Blob([migrationCandidate.devVars], { type: "text/plain;charset=utf-8" });
      downloadBlob(envBlob, ".dev.vars");
      setMigrationMessage(`恢复完成：新增 ${result.imported} 个素材，跳过 ${result.skipped} 个重复素材。已下载 .dev.vars，请放回项目根目录后重启服务。`);
      window.setTimeout(() => window.location.reload(), 1600);
    } catch (error) {
      setMigrationMessage("");
      setMigrationFailure(error instanceof Error ? error.message : "迁移恢复失败，请重试。");
      setIsMigrationWorking(false);
    }
  };

  const exportWorkspaceBackup = async () => {
    setIsBackupWorking(true);
    setBackupFailure("");
    setBackupMessage("正在整理素材和本地记录…");
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      const records = assets.map((asset) => {
        const record = toStoredRecord(asset);
        if (asset.kind !== "text") return record;
        const file = new Blob([asset.textContent ?? ""], { type: asset.mime || "text/plain;charset=utf-8" });
        return { ...record, file, size: file.size };
      });
      const promptState: StoredPromptState = {
        id: "workspace",
        favorites: favoritePromptIds,
        recent: recentPromptIds,
        drafts: promptDrafts,
        assetCategories,
        updatedAt: Date.now(),
      };
      const { blob, manifest } = createFrameVaultBackup(records, promptState);
      const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-").replace("T", "_");
      const filename = `FrameVault-${timestamp}.framevault`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setBackupMessage(`备份已生成：${manifest.assetCount} 个素材，共 ${formatBytes(manifest.totalBytes)}`);
    } catch (error) {
      setBackupMessage("");
      setBackupFailure(error instanceof Error ? error.message : "备份生成失败，请重试");
    } finally {
      setIsBackupWorking(false);
    }
  };

  const prepareBackupFile = async (file?: File) => {
    if (!file) return;
    setIsBackupWorking(true);
    setBackupCandidate(null);
    setBackupCandidateName(file.name);
    setBackupFailure("");
    setBackupMessage("正在校验备份文件…");
    try {
      const parsed = await parseFrameVaultBackup(file);
      setBackupCandidate(parsed);
      setBackupMessage(`校验完成：${parsed.manifest.assetCount} 个素材，共 ${formatBytes(parsed.manifest.totalBytes)}`);
    } catch (error) {
      setBackupMessage("");
      setBackupFailure(error instanceof Error ? error.message : "无法读取这个备份文件");
    } finally {
      setIsBackupWorking(false);
    }
  };

  const restoreWorkspaceBackup = async () => {
    if (!backupCandidate || (restoreMode === "replace" && !replaceConfirmed)) return;
    setIsBackupWorking(true);
    setBackupFailure("");
    setBackupMessage("正在写入本机素材库，请不要关闭页面…");
    try {
      const result = await restoreStoredWorkspace(
        backupCandidate.assets,
        backupCandidate.promptState,
        restoreMode,
      );
      setBackupMessage(
        restoreMode === "replace"
          ? `恢复完成：已写入 ${result.imported} 个素材，正在重新加载…`
          : `合并完成：新增 ${result.imported} 个素材，跳过 ${result.skipped} 个重复素材，正在重新加载…`,
      );
      window.setTimeout(() => window.location.reload(), 1100);
    } catch (error) {
      setBackupMessage("");
      setBackupFailure(error instanceof Error ? error.message : "恢复失败，当前素材库未完成更新");
      setIsBackupWorking(false);
    }
  };

  const visibleAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesLocation = filter === "all"
        ? (keyword ? true : asset.collection === "library")
        : (filter.startsWith("category:")
          ? asset.collection === "category" && asset.category === filter.slice(9)
          : asset.collection === "library" && asset.kind === filter);
      const matchesQuery = !keyword
        || asset.name.toLowerCase().includes(keyword)
        || asset.extension.toLowerCase().includes(keyword)
        || asset.category.toLowerCase().includes(keyword)
        || (asset.linkUrl ?? "").toLowerCase().includes(keyword)
        || (asset.textContent ?? "").toLowerCase().includes(keyword);
      return matchesLocation && matchesQuery;
    });
  }, [assets, filter, query]);

  useEffect(() => {
    if (isLoadingSaved) return;
    if (!visibleAssets.some((asset) => asset.id === selectedId)) {
      setSelectedId(visibleAssets[0]?.id ?? null);
    }
  }, [isLoadingSaved, selectedId, visibleAssets]);

  const totalSize = useMemo(() => assets.reduce((sum, asset) => sum + asset.size, 0), [assets]);
  const libraryAssetCount = assets.filter((asset) => asset.collection === "library").length;
  const visibleSize = useMemo(() => visibleAssets.reduce((sum, asset) => sum + asset.size, 0), [visibleAssets]);
  const visibleCategoryChoices = useMemo(() => {
    const keyword = categoryBrowserQuery.trim().toLowerCase();
    return keyword
      ? assetCategories.filter((category) => category.toLowerCase().includes(keyword))
      : assetCategories;
  }, [assetCategories, categoryBrowserQuery]);
  const imageCount = assets.filter((asset) => asset.collection === "library" && asset.kind === "image").length;
  const videoCount = assets.filter((asset) => asset.collection === "library" && asset.kind === "video").length;
  const audioCount = assets.filter((asset) => asset.collection === "library" && asset.kind === "audio").length;
  const textCount = assets.filter((asset) => asset.collection === "library" && asset.kind === "text").length;
  const linkCount = assets.filter((asset) => asset.collection === "library" && asset.kind === "link").length;
  const isGlobalAssetSearch = filter === "all" && query.trim().length > 0;
  const isCategoryFilter = filter.startsWith("category:");
  const showFileImport = filter !== "text" && filter !== "link";
  const showTextCreator = filter === "all" || filter === "text" || isCategoryFilter;
  const showLinkCreator = filter === "all" || filter === "link" || isCategoryFilter;
  const importLabel = filter === "video" ? "添加视频" : filter === "audio" ? "添加音频" : filter === "image" ? "添加图片" : "添加";
  const importTileLabel = filter === "video" ? "导入视频素材" : filter === "audio" ? "导入音频素材" : filter === "image" ? "导入图片素材" : "导入新素材";
  const importTileHint = filter === "video"
    ? "VIDEO · DROP HERE"
    : filter === "audio"
      ? "AUDIO · DROP HERE"
    : filter === "image"
      ? "IMAGE · DROP HERE"
      : "IMAGE / VIDEO / AUDIO / TEXT · DROP HERE";
  const acceptedFileTypes = filter === "video"
    ? "video/*,.mkv,.avi"
    : filter === "audio"
      ? "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.wma"
    : filter === "image"
      ? "image/*,.heic,.heif"
      : filter === "text"
        ? "text/plain,.txt,.md,.markdown"
        : "image/*,video/*,audio/*,text/plain,.txt,.md,.markdown,.mkv,.avi,.heic,.heif,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.wma";
  const activePromptCategories = useMemo(
    () => promptCategories.filter((category) => category.kind === promptKind),
    [promptKind],
  );
  const activePromptCategory = promptCategories.find((category) => category.id === promptCategoryId)
    ?? activePromptCategories[0];
  const visiblePrompts = useMemo(() => {
    const keyword = promptQuery.trim().toLowerCase();
    const matches = promptEntries.filter((entry) => {
      if (entry.kind !== promptKind) return false;
      const matchesScope = promptScope === "favorites"
        ? favoritePromptIds.includes(entry.id)
        : promptScope === "recent"
          ? recentPromptIds.includes(entry.id)
          : entry.categoryId === activePromptCategory?.id;
      const searchablePrompt = promptDrafts[entry.id] ?? entry.prompt;
      return matchesScope && (!keyword || `${entry.title} ${searchablePrompt} ${entry.tags.join(" ")}`.toLowerCase().includes(keyword));
    });
    if (promptScope === "recent") return matches.sort((left, right) => recentPromptIds.indexOf(left.id) - recentPromptIds.indexOf(right.id));
    if (promptScope === "favorites") return matches.sort((left, right) => favoritePromptIds.indexOf(left.id) - favoritePromptIds.indexOf(right.id));
    return matches;
  }, [activePromptCategory?.id, favoritePromptIds, promptDrafts, promptKind, promptQuery, promptScope, recentPromptIds]);
  const selectedPrompt = promptEntries.find((entry) => entry.id === selectedPromptId)
    ?? visiblePrompts[0];
  const selectedPromptText = selectedPrompt ? (promptDrafts[selectedPrompt.id] ?? selectedPrompt.prompt) : "";
  const promptPageSize = 20;
  const promptPageCount = Math.max(1, Math.ceil(visiblePrompts.length / promptPageSize));
  const pagedPrompts = visiblePrompts.slice(promptPage * promptPageSize, (promptPage + 1) * promptPageSize);

  useEffect(() => {
    setPromptPage(0);
  }, [activePromptCategory?.id, promptKind, promptQuery, promptScope]);

  useEffect(() => {
    if (!visiblePrompts.some((entry) => entry.id === selectedPromptId)) {
      setSelectedPromptId(visiblePrompts[0]?.id ?? "");
    }
  }, [selectedPromptId, visiblePrompts]);

  const changePromptKind = (kind: PromptKind) => {
    const category = promptCategories.find((item) => item.kind === kind);
    if (!category) return;
    setPromptKind(kind);
    setPromptCategoryId(category.id);
    setSelectedPromptId(`${category.id}-01`);
    setPromptScope("category");
  };

  const changePromptCategory = (id: string) => {
    setPromptCategoryId(id);
    setSelectedPromptId(`${id}-01`);
    setPromptScope("category");
  };

  const selectPrompt = (id: string) => {
    setSelectedPromptId(id);
    setRecentPromptIds((current) => [id, ...current.filter((item) => item !== id)].slice(0, 40));
  };

  const togglePromptFavorite = (id: string) => {
    setFavoritePromptIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [id, ...current]);
  };

  const copyPrompt = async () => {
    if (!selectedPrompt) return;
    try {
      await navigator.clipboard.writeText(selectedPromptText);
      selectPrompt(selectedPrompt.id);
      setNotice("提示词已复制到剪贴板");
      window.setTimeout(() => setNotice(""), 1600);
    } catch {
      setNotice("复制失败，请在右侧文本框中手动复制");
    }
  };

  const selectedAiOption = AI_MODEL_OPTIONS.find((item) => item.id === aiModel) ?? AI_MODEL_OPTIONS[0];
  const aiPromptMaximum = aiModel === "gpt-image-2" ? 1000 : 4000;
  const selectedAiConfig = aiConfig?.models.find((model) => model.id === aiModel);
  const aiModelAvailable = selectedAiConfig?.available === true;
  const aiTaskActive = aiGeneration?.status === "queued" || aiGeneration?.status === "running";
  const aiEstimatedCost = aiModel === "gpt-image-2"
    ? "约 ¥0.07 / 张"
    : aiModel === "seedream-5"
      ? "按 New.bi 实际用量"
      : aiModel === "minimax-h3"
        ? `约 ¥${(aiVideoDuration * 0.3).toFixed(2)}`
        : `约 ¥${(aiVideoDuration * 0.85).toFixed(2)}`;
  const aiCanSubmit = Boolean(
    aiPrompt.trim()
    && aiModelAvailable
    && !aiBusy
    && !aiTaskActive
    && (!aiConfig?.accessTokenRequired || aiAccessToken.trim()),
  );

  return (
    <main className="workspace-shell">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i />FV</span>
          <div>
            <h1>FRAME VAULT</h1>
            <p>本地素材管理终端</p>
          </div>
        </div>
        <div className="topbar-readout">
          <span>SESSION</span>
          <strong>{String(assets.length).padStart(2, "0")}</strong>
          <i />
          <span>STORAGE</span>
          <strong>{formatBytes(totalSize)}</strong>
        </div>
        <div className={`local-status ${externalDirectory ? `external ${externalStorageStatus}` : ""}`} title={externalDirectory ? externalStorageMessage : "文件不会上传至网络"}>
          <span className="status-dot" />
          {isExternalSyncing ? "SYNCING FOLDER" : externalDirectory ? externalStorageStatus === "connected" ? "EXTERNAL MIRROR" : "FOLDER OFFLINE" : "SAVED LOCALLY"}
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="side-panel">
          <div className="side-title">
            <span>{workspaceMode === "assets" ? "素材收藏夹" : "提示词分类"}</span>
            <b>⌄</b>
          </div>
          <div className="side-panel-scroll">
          {workspaceMode === "assets" && (
            <div className="anime-side-banner" aria-hidden="true">
              <span>MY COLLECTION</span>
              <strong>创作素材盒</strong>
              <i>✦</i>
            </div>
          )}
          {workspaceMode === "assets" ? (
            <>
              <nav className="filter-list" aria-label="素材筛选">
                <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
                  <span><i className="nav-symbol grid-symbol" />全部素材</span>
                  <b>{libraryAssetCount}</b>
                </button>
                <button className={filter === "video" ? "active" : ""} onClick={() => setFilter("video")}>
                  <span><i className="nav-symbol video-symbol" />视频</span>
                  <b>{videoCount}</b>
                </button>
                <button className={filter === "audio" ? "active" : ""} onClick={() => setFilter("audio")}>
                  <span><i className="nav-symbol audio-symbol" />音频</span>
                  <b>{audioCount}</b>
                </button>
                <button className={filter === "image" ? "active" : ""} onClick={() => setFilter("image")}>
                  <span><i className="nav-symbol image-symbol" />图片</span>
                  <b>{imageCount}</b>
                </button>
                <button className={filter === "text" ? "active" : ""} onClick={() => setFilter("text")}>
                  <span><i className="nav-symbol text-symbol" />文本</span>
                  <b>{textCount}</b>
                </button>
                <button className={filter === "link" ? "active" : ""} onClick={() => setFilter("link")}>
                  <span><i className="nav-symbol link-symbol" />链接</span>
                  <b>{linkCount}</b>
                </button>
              </nav>

              <div className="side-divider" />
              <div className="custom-category-heading">
                <span>自定义类目</span>
                <button onClick={() => setIsAddingCategory((value) => !value)}>＋ 添加类目</button>
              </div>
              <button
                className="category-browser-trigger"
                onClick={() => setIsCategoryBrowserOpen(true)}
                aria-haspopup="dialog"
              >
                <span><i>▦</i> 查看全部类目</span>
                <b>{assetCategories.length}</b>
                <em>↗</em>
              </button>
              {isAddingCategory && (
                <div className="category-create-row">
                  <input
                    autoFocus
                    value={categoryDraft}
                    maxLength={24}
                    placeholder="输入类目名称"
                    aria-label="新类目名称"
                    onChange={(event) => setCategoryDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") addAssetCategory();
                      if (event.key === "Escape") { setCategoryDraft(""); setIsAddingCategory(false); }
                    }}
                  />
                  <button onClick={addAssetCategory} disabled={!categoryDraft.trim()}>确定</button>
                </div>
              )}
              <nav className="custom-category-list" aria-label="自定义素材类目">
                {assetCategories.map((category) => {
                  const categoryFilter = `category:${category}` as Filter;
                  return (
                    <div key={category} className={`category-list-row ${filter === categoryFilter ? "active" : ""}`}>
                      <button className="category-filter-button" onClick={() => setFilter(categoryFilter)}>
                        <span>{category}</span>
                        <b>{assets.filter((asset) => asset.collection === "category" && asset.category === category).length}</b>
                      </button>
                      {category !== DEFAULT_ASSET_CATEGORY && (
                        <button
                          className="category-delete-button"
                          aria-label={`删除类目 ${category}`}
                          title="删除类目"
                          onClick={() => setCategoryPendingDelete(category)}
                        >×</button>
                      )}
                    </div>
                  );
                })}
              </nav>

              {isCategoryBrowserOpen && typeof document !== "undefined" && createPortal((
                <div className="category-browser-overlay" role="presentation">
                  <section className="category-browser-dialog" role="dialog" aria-modal="true" aria-labelledby="category-browser-title">
                    <header>
                      <div>
                        <span>CATEGORY DIRECTORY</span>
                        <h3 id="category-browser-title">查看全部类目</h3>
                        <p>搜索类目名称，点击即可进入对应素材区。</p>
                      </div>
                      <button onClick={() => setIsCategoryBrowserOpen(false)} aria-label="关闭全部类目窗口">×</button>
                    </header>
                    <label className="category-browser-search">
                      <i aria-hidden="true">⌕</i>
                      <input
                        type="search"
                        value={categoryBrowserQuery}
                        onChange={(event) => setCategoryBrowserQuery(event.target.value)}
                        placeholder="搜索类目名称"
                        aria-label="搜索全部类目"
                      />
                      <b>{visibleCategoryChoices.length} / {assetCategories.length}</b>
                    </label>
                    <div className="category-browser-grid">
                      {visibleCategoryChoices.map((category) => {
                        const categoryFilter = `category:${category}` as Filter;
                        const categoryCount = assets.filter((asset) => asset.collection === "category" && asset.category === category).length;
                        return (
                          <button
                            key={category}
                            className={filter === categoryFilter ? "active" : ""}
                            onClick={() => {
                              setFilter(categoryFilter);
                              setCategoryBrowserQuery("");
                              setIsCategoryBrowserOpen(false);
                            }}
                          >
                            <span>{category}</span>
                            <small>{categoryCount} 个素材</small>
                            <i>进入 →</i>
                          </button>
                        );
                      })}
                      {!visibleCategoryChoices.length && (
                        <div className="category-browser-empty">
                          <strong>没有匹配的类目</strong>
                          <span>换一个关键词试试。</span>
                        </div>
                      )}
                    </div>
                    <footer><span>共 {assetCategories.length} 个类目</span><small>按 ESC 关闭</small></footer>
                  </section>
                </div>
              ), document.body)}

              <div className="side-divider compact-divider" />
              <div className="side-group-label">格式索引</div>
              <div className="format-index">
                <span>MP4</span><span>MOV</span><span>MP3</span><span>WAV</span><span>M4A</span><span>PNG</span><span>JPG</span><span>WEBM</span><span>HEIC</span><span>TXT</span><span>MD</span><span>URL</span>
              </div>
            </>
          ) : (
            <>
              <nav className="prompt-kind-list" aria-label="提示词类型">
                {(["image", "video", "text"] as PromptKind[]).map((kind) => (
                  <button key={kind} className={promptKind === kind ? "active" : ""} onClick={() => changePromptKind(kind)}>
                    <span>{kind === "image" ? "▧" : kind === "video" ? "▷" : "¶"} {promptKindLabels[kind]}</span>
                    <b>{promptCategories.filter((item) => item.kind === kind).length * 80}</b>
                  </button>
                ))}
              </nav>
              <div className="side-divider" />
              <div className="side-group-label">主分类 · 每类 80 条</div>
              <nav className="prompt-category-list" aria-label={`${promptKindLabels[promptKind]}分类`}>
                {activePromptCategories.map((category) => (
                  <button key={category.id} className={activePromptCategory?.id === category.id ? "active" : ""} onClick={() => changePromptCategory(category.id)}>
                    <span>{category.name}</span><b>80</b>
                  </button>
                ))}
              </nav>
            </>
          )}
          </div>

          <div className={`privacy-note ${isLocalStatusExpanded ? "expanded" : "collapsed"}`}>
            <button
              type="button"
              className="privacy-note-toggle"
              aria-expanded={isLocalStatusExpanded}
              aria-controls="local-persistence-details"
              onClick={() => setIsLocalStatusExpanded((value) => !value)}
            >
              <span className="privacy-icon">◎</span>
              <span className="privacy-note-title">
                <strong>{externalDirectory ? "外部素材目录" : "本机持久保存"}</strong>
                <small><i /> {isExternalSyncing ? "SYNCING" : externalStorageStatus === "connected" ? "FOLDER CONNECTED" : externalStorageStatus === "permission" ? "RECONNECT NEEDED" : externalStorageStatus === "error" ? "SYNC ERROR" : "LOCAL DB · PERSISTENT"}</small>
              </span>
              <b aria-hidden="true">{isLocalStatusExpanded ? "⌄" : "⌃"}</b>
            </button>
            {isLocalStatusExpanded && (
              <div className="privacy-note-details" id="local-persistence-details">
              <p>{externalDirectory
                ? externalStorageMessage || `素材正在同步到“${externalDirectory.locationLabel ?? externalDirectoryDefaultLabel(externalDirectory.name)}”，浏览器副本保留用于回退。`
                : workspaceMode === "assets"
                  ? externalStorageMessage || "素材与提示词保存在浏览器本机，也可以选择硬盘或 U 盘目录同步。"
                  : "共 24 类、1,920 条本地整理模板，可离线搜索和复制。"}</p>
              {workspaceMode === "assets" && (
                <>
                  <div className="workspace-backup-actions">
                    <button onClick={() => openBackupDialog("export")}>⇩ 整库备份</button>
                    <button onClick={() => openBackupDialog("restore")}>⇧ 恢复素材库</button>
                    <button onClick={() => openMigrationDialog("export")}>🔐 加密迁移包</button>
                    <button onClick={() => openMigrationDialog("import")}>⇧ 导入迁移包</button>
                  </div>
                  <div className={`external-storage-actions ${externalStorageStatus}`}>
                    {!externalDirectory ? (
                      <button disabled={externalStorageStatus === "connecting"} onClick={() => void connectExternalFolder()}>
                        {externalStorageStatus === "connecting" ? "正在连接…" : "▣ 选择硬盘 / U盘目录"}
                      </button>
                    ) : (
                      <>
                        <button
                          disabled={isExternalSyncing || externalStorageStatus === "connecting"}
                          onClick={() => externalStorageStatus === "connected"
                            ? void flushExternalSync(true)
                            : void connectExternalFolder(externalDirectory.handle)}
                        >{externalStorageStatus === "connected" ? "↻ 立即同步" : "↻ 重新连接"}</button>
                        <button disabled={isExternalSyncing} onClick={() => void stopUsingExternalFolder()}>停止使用</button>
                      </>
                    )}
                  </div>
                  {externalDirectory && (
                    <>
                      <label className="external-location-row">
                        <span>同步位置</span>
                        <input
                          value={externalLocationDraft}
                          maxLength={60}
                          placeholder="例如：F盘素材库"
                          aria-label="外部素材同步位置标记"
                          onChange={(event) => setExternalLocationDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveExternalLocationLabel();
                          }}
                        />
                        <button onClick={() => void saveExternalLocationLabel()}>保存</button>
                      </label>
                      <small className="external-directory-name" title={externalDirectory.name}>浏览器目录 · {externalDirectoryDefaultLabel(externalDirectory.name)}</small>
                    </>
                  )}
                </>
              )}
              </div>
            )}
          </div>
        </aside>

        <section
          className={`library-panel ${isDragging ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
          }}
          onDrop={onDrop}
        >
          {workspaceMode === "assets" ? (
            <>
          <div className="library-toolbar">
            <div className="library-heading">
              <span>ASSET MATRIX / 01</span>
              <h2>素材库</h2>
              <p>{isLoadingSaved ? "正在读取本机素材库…" : visibleAssets.length ? `${visibleAssets.length} 个素材 · ${formatBytes(visibleSize)}` : "当前区域等待导入素材"}</p>
            </div>
            <div className="toolbar-actions">
              <a className="ai-studio-button" href="/ai">
                <span aria-hidden="true">✦</span> AI 生成
              </a>
              <label className="search-box">
                <i aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={filter === "all" ? "搜索全库文件名、格式或类目" : "搜索文件名或格式"}
                  aria-label="搜索素材"
                />
                <kbd>⌘ K</kbd>
              </label>
              {showFileImport && (
                <button className="upload-button" onClick={() => inputRef.current?.click()}>
                  <span aria-hidden="true">＋</span> {importLabel}
                </button>
              )}
              {showTextCreator && (
                <button className="text-add-button" onClick={() => setIsAddingText(true)}>
                  <span aria-hidden="true">¶</span> {filter === "text" ? "新建文本" : "文本"}
                </button>
              )}
              {showLinkCreator && (
                <button className="text-add-button" onClick={() => setIsAddingLink(true)}>
                  <span aria-hidden="true">↗</span> {filter === "link" ? "添加链接" : "链接"}
                </button>
              )}
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept={acceptedFileTypes}
                multiple
                onChange={onInputChange}
              />
            </div>
          </div>

          <div className="asset-grid" role="list">
            {showFileImport && (
              <button className="upload-tile" onClick={() => inputRef.current?.click()}>
                <span className="upload-tile-icon">✦</span>
                <strong>{importTileLabel}</strong>
                <small>{importTileHint}</small>
              </button>
            )}

            {showTextCreator && (
              <button className="upload-tile text-create-tile" onClick={() => setIsAddingText(true)}>
                <span className="upload-tile-icon">¶</span>
                <strong>新建文本素材</strong>
                <small>WRITE / NOTE · SAVED LOCALLY</small>
              </button>
            )}

            {showLinkCreator && (
              <button className="upload-tile link-create-tile" onClick={() => setIsAddingLink(true)}>
                <span className="upload-tile-icon">↗</span>
                <strong>添加链接素材</strong>
                <small>URL / WEBSITE · SAVED LOCALLY</small>
              </button>
            )}

            {visibleAssets.map((asset, index) => (
              <article
                key={asset.id}
                role="listitem"
                tabIndex={0}
                className={`asset-card ${selectedId === asset.id ? "selected" : ""}`}
                onClick={() => setSelectedId(asset.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedId(asset.id);
                }}
              >
                <div className="asset-visual">
                  {asset.kind === "text" ? (
                    <div className="text-card-preview">
                      <span>TEXT NOTE</span>
                      <p>{asset.textContent || "空白文本"}</p>
                    </div>
                  ) : asset.kind === "link" ? (
                    <LinkArtwork url={asset.linkUrl} compact />
                  ) : asset.kind === "audio" ? (
                    <AudioArtwork compact />
                  ) : asset.kind === "image" ? (
                    <img src={asset.url} alt="" />
                  ) : (
                    <video
                      key={`card-${asset.id}`}
                      src={asset.url}
                      poster={asset.thumbnailUrl}
                      muted
                      playsInline
                      preload="metadata"
                      aria-label={`${asset.name} 视频画面`}
                      onLoadedMetadata={(event) => {
                        syncVideoMetadata(asset.id, event.currentTarget);
                        const duration = event.currentTarget.duration;
                        if (Number.isFinite(duration) && duration > 0.1) {
                          event.currentTarget.currentTime = Math.min(0.18, duration * 0.08);
                        }
                      }}
                    />
                  )}
                  <div className="frame-corners" aria-hidden="true"><i /><i /><i /><i /></div>
                  <span className="asset-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="type-badge">{asset.kind === "video" ? "VIDEO" : asset.kind === "audio" ? "AUDIO" : asset.kind === "image" ? "IMAGE" : asset.kind === "link" ? "LINK" : "TEXT"}</span>
                  {asset.kind === "video" && <span className="play-badge">▶</span>}
                  <button
                    className="remove-button"
                    aria-label={`移除 ${asset.name}`}
                    title="从列表移除"
                    onClick={(event) => { event.stopPropagation(); removeAsset(asset.id); }}
                  >×</button>
                </div>
                <div className="asset-card-info">
                  <strong title={asset.name}>{asset.name}</strong>
                  {isGlobalAssetSearch && asset.collection === "category" && (
                    <span className="asset-category-origin" title={`所属类目：${asset.category}`}>类目 · {asset.category}</span>
                  )}
                  <div>
                    <span>{asset.extension}</span>
                    <span>{asset.kind === "text" ? `${(asset.textContent ?? "").length} 字符` : asset.kind === "link" ? linkHost(asset.linkUrl) : asset.kind === "audio" ? "音频素材" : asset.status === "unsupported" ? "格式不支持" : asset.width && asset.height ? `${asset.width} × ${asset.height}` : "识别中"}</span>
                    {(asset.kind === "video" || asset.kind === "audio") && <span>{formatDuration(asset.duration)}</span>}
                  </div>
                </div>
                <div className="asset-card-footer">
                  <span>{asset.kind === "text" ? "纯文本" : asset.kind === "link" ? "网页链接" : asset.kind === "audio" ? "声音" : ratioLabel(asset.width, asset.height)}</span>
                  <i />
                  <span>{formatBytes(asset.size)}</span>
                  <b>{asset.kind === "text" ? `${(asset.textContent ?? "").split(/\r?\n/).length} 行` : asset.kind === "link" ? "跳转 ↗" : asset.kind === "audio" ? formatDuration(asset.duration) : orientationLabel(asset.width, asset.height)}</b>
                </div>
              </article>
            ))}
          </div>

          {!visibleAssets.length && assets.length > 0 && (
            <div className="empty-results">
              <span>NO MATCH</span>
              <strong>没有匹配的素材</strong>
              <p>换个关键词或切换分类试试。</p>
            </div>
          )}

          {!assets.length && !isLoadingSaved && (
            <div className="empty-library">
              <div className="empty-orbit"><i /><i /><span>＋</span></div>
              <strong>把素材放进矩阵</strong>
              <p>导入图片、视频或音频，也可以直接新建文本或链接素材。</p>
            </div>
          )}

          {isDragging && (
            <div className="drop-overlay">
              <span>⇩</span>
              <strong>松开以导入素材</strong>
              <small>文件只在本地处理</small>
            </div>
          )}
            </>
          ) : (
            <>
              <div className="library-toolbar prompt-library-toolbar">
                <div className="library-heading">
                  <span>PROMPT ARCHIVE / {promptKind.toUpperCase()}</span>
                  <h2>{promptScope === "favorites" ? "我的收藏" : promptScope === "recent" ? "最近使用" : activePromptCategory?.name ?? "提示词库"}</h2>
                  <p>{promptScope === "category" ? activePromptCategory?.description : promptScope === "favorites" ? "长期保存的个人精选模板" : "最近打开、复制或编辑过的模板"} · 当前 {visiblePrompts.length} 条</p>
                </div>
                <div className="toolbar-actions">
                  <label className="search-box">
                    <i aria-hidden="true" />
                    <input type="search" value={promptQuery} onChange={(event) => setPromptQuery(event.target.value)} placeholder="搜索标题、内容或标签" aria-label="搜索提示词" />
                    <kbd>{visiblePrompts.length}</kbd>
                  </label>
                  <a className="source-button" href={activePromptCategory?.sourceUrl} target="_blank" rel="noreferrer">分类来源 ↗</a>
                </div>
              </div>

              <div className="prompt-catalog-note">
                <span>LOCAL CURATION</span>
                <p>参考 Prompt123 的分类体系重新编写，保留来源入口；模板为本地整理，可直接复制后替换主题变量。</p>
                <div className="prompt-scope-switch" aria-label="提示词视图">
                  <button className={promptScope === "category" ? "active" : ""} onClick={() => setPromptScope("category")}>分类</button>
                  <button className={promptScope === "favorites" ? "active" : ""} onClick={() => setPromptScope("favorites")}>收藏 {favoritePromptIds.length}</button>
                  <button className={promptScope === "recent" ? "active" : ""} onClick={() => setPromptScope("recent")}>最近 {recentPromptIds.length}</button>
                </div>
              </div>

              <div className="prompt-card-grid" role="list">
                {pagedPrompts.map((entry) => (
                  <article
                    key={entry.id}
                    role="listitem"
                    tabIndex={0}
                    className={`prompt-card ${selectedPrompt?.id === entry.id ? "selected" : ""}`}
                    style={{ "--prompt-hue": entry.hue } as React.CSSProperties}
                    onClick={() => selectPrompt(entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") selectPrompt(entry.id);
                    }}
                  >
                    <div className="prompt-card-visual">
                      <span>{entry.kind === "image" ? "IMG" : entry.kind === "video" ? "VID" : "TXT"}</span>
                      <strong>{String(entry.index).padStart(2, "0")}</strong>
                      <i />
                      <button
                        className={`prompt-favorite-button ${favoritePromptIds.includes(entry.id) ? "active" : ""}`}
                        aria-label={favoritePromptIds.includes(entry.id) ? `取消收藏 ${entry.title}` : `收藏 ${entry.title}`}
                        onClick={(event) => { event.stopPropagation(); togglePromptFavorite(entry.id); }}
                      >{favoritePromptIds.includes(entry.id) ? "★" : "☆"}</button>
                    </div>
                    <div className="prompt-card-copy">
                      <small>{entry.categoryName} · {entry.ratio}</small>
                      <strong>{entry.title}</strong>
                      <p>{entry.prompt}</p>
                    </div>
                    <div className="prompt-card-tags">
                      {entry.tags.slice(0, 2).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </article>
                ))}
              </div>

              {visiblePrompts.length > promptPageSize && (
                <div className="prompt-pagination">
                  <button disabled={promptPage === 0} onClick={() => setPromptPage((page) => Math.max(0, page - 1))}>← 上一页</button>
                  <span>第 <strong>{promptPage + 1}</strong> / {promptPageCount} 页 · 每页 20 条</span>
                  <button disabled={promptPage >= promptPageCount - 1} onClick={() => setPromptPage((page) => Math.min(promptPageCount - 1, page + 1))}>下一页 →</button>
                </div>
              )}

              {!visiblePrompts.length && (
                <div className="empty-results">
                  <span>NO MATCH</span><strong>没有匹配的提示词</strong><p>换个关键词或切换左侧分类。</p>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="inspector-panel">
          <div className="inspector-topline"><span>{workspaceMode === "assets" ? "INSPECTOR" : "PROMPT DETAIL"}</span><i /><b>{workspaceMode === "assets" ? (selected ? "ACTIVE" : "STANDBY") : "READY"}</b></div>

          {workspaceMode === "assets" ? (selected ? (
            <>
              <div className="asset-identity">
                <div>
                  <span>素材名称</span>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveName();
                        if (event.key === "Escape") setIsRenaming(false);
                      }}
                      onBlur={saveName}
                      aria-label="修改素材名称"
                    />
                  ) : (
                    <strong title={selected.name}>{selected.name}</strong>
                  )}
                </div>
                <button onClick={() => { setDraftName(selected.name); setIsRenaming(true); }}>
                  ◇ <span>修改</span>
                </button>
              </div>

              <label className="asset-category-select">
                <span>移动到类目</span>
                <select
                  value={selected.collection === "library" ? "__library__" : selected.category}
                  onChange={(event) => moveSelectedAsset(event.target.value)}
                  aria-label={`移动 ${selected.name} 到指定类目`}
                >
                  <option value="__library__">素材库根目录</option>
                  {assetCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>

              <div className="module-heading preview-module-heading">
                <span>{selected.kind === "text" ? "文本内容" : selected.kind === "link" ? "链接信息" : selected.kind === "audio" ? "音频试听" : "画面预览"}</span>
                <div><b>{selected.extension}</b><button onClick={openPreview}>{selected.kind === "text" ? "展开" : selected.kind === "link" ? "跳转" : selected.kind === "audio" ? "试听" : "预览"} ↗</button></div>
              </div>
              <div
                ref={previewStageRef}
                className={`preview-stage ${selected.kind} ${selected.kind === "image" && zoom > 100 ? "can-pan" : ""} ${isPreviewPanning ? "panning" : ""}`}
                title={selected.kind === "image" ? "Ctrl + 滚轮缩放；放大后按住鼠标拖动画面" : selected.kind === "text" ? "文本会自动保存到本机" : selected.kind === "link" ? "打开外部链接" : selected.kind === "audio" ? "音频试听" : "视频预览"}
                onPointerDown={(event) => beginPan(event, "preview")}
                onPointerMove={(event) => movePan(event, "preview")}
                onPointerUp={(event) => endPan(event, "preview")}
                onPointerCancel={(event) => endPan(event, "preview")}
              >
                {selected.kind === "text" ? (
                  <textarea
                    className="text-asset-editor"
                    value={selected.textContent ?? ""}
                    onChange={(event) => updateAsset(selected.id, {
                      textContent: event.target.value,
                      size: new Blob([event.target.value]).size,
                    })}
                    placeholder="在这里编辑文本内容…"
                    aria-label="文本素材内容"
                    spellCheck={false}
                  />
                ) : selected.kind === "link" ? (
                  <button className="link-preview-button" onClick={openPreview} aria-label={`跳转到 ${selected.name}`}>
                    <LinkArtwork url={selected.linkUrl} />
                  </button>
                ) : selected.kind === "audio" ? (
                  <div className="audio-preview-player">
                    <AudioArtwork />
                    <audio
                      key={selected.id}
                      src={selected.url}
                      controls
                      preload="metadata"
                      onLoadedMetadata={(event) => syncAudioMetadata(selected.id, event.currentTarget)}
                    />
                  </div>
                ) : selected.kind === "video" ? (
                  <video
                    key={selected.id}
                    src={selected.url}
                    controls
                    preload="metadata"
                    onLoadedMetadata={(event) => syncVideoMetadata(selected.id, event.currentTarget)}
                  />
                ) : selected.status === "unsupported" ? (
                  <div className="preview-error"><span>!</span><p>当前浏览器无法预览此图片格式</p></div>
                ) : (
                  <div className="image-viewport">
                    <img
                      key={selected.id}
                      src={selected.url}
                      alt={selected.name}
                      style={{ transform: `translate3d(${previewPan.x}px, ${previewPan.y}px, 0) scale(${zoom / 100})` }}
                      draggable={false}
                    />
                  </div>
                )}
                {(selected.kind === "image" || selected.kind === "video") && <span className="preview-ratio">{ratioLabel(selected.width, selected.height)}</span>}
              </div>

              {selected.kind === "text" ? (
                <div className="preview-controls text-preview-controls">
                  <span className="wheel-hint">编辑后自动保存到本机</span>
                  <button onClick={copySelectedText}>复制文本</button>
                  <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(selected.textContent ?? "")}`} download={selected.name} aria-label="下载文本素材">↓ 下载</a>
                </div>
              ) : selected.kind === "link" ? (
                <div className="preview-controls link-preview-controls">
                  <span className="wheel-hint">链接将在新窗口中打开</span>
                  <button onClick={openPreview}>跳转链接 ↗</button>
                </div>
              ) : selected.kind === "audio" ? (
                <div className="preview-controls audio-preview-controls">
                  <span className="wheel-hint">音频时长 {formatDuration(selected.duration)}</span>
                  <a href={selected.url} download={selected.name} aria-label="下载音频素材">↓ 下载音频</a>
                </div>
              ) : selected.kind === "video" ? (
                <div className="preview-controls video-preview-controls">
                  <span className="wheel-hint">默认暂停 · 时长 {formatDuration(selected.duration)}</span>
                  <a href={selected.url} download={selected.name} aria-label="下载视频素材">↓ 下载视频</a>
                </div>
              ) : (
                <div className="preview-controls">
                  <span className="wheel-hint"><kbd>Ctrl</kbd> + 滚轮缩放{zoom > 100 ? " · 按住拖动" : ""}</span>
                  <button aria-label="缩小预览" onClick={() => setZoom((value) => Math.max(25, value - 25))}>−</button>
                  <button className="zoom-value" onClick={() => { setZoom(100); setPreviewPan({ x: 0, y: 0 }); }}>{zoom}%</button>
                  <button aria-label="放大预览" onClick={() => setZoom((value) => Math.min(400, value + 25))}>＋</button>
                  <a href={selected.url} download={selected.name} aria-label="下载素材">↓</a>
                </div>
              )}

              <div className="module-heading"><span>参数信息</span><b>METADATA</b></div>
              <div className="metadata-grid">
                <div><span>{selected.kind === "text" ? "字符数量" : selected.kind === "link" ? "链接域名" : selected.kind === "audio" ? "音频格式" : "分辨率"}</span><strong>{selected.kind === "text" ? `${(selected.textContent ?? "").length} 字符` : selected.kind === "link" ? linkHost(selected.linkUrl) : selected.kind === "audio" ? selected.extension : selected.status === "unsupported" ? "格式不支持" : selected.width && selected.height ? `${selected.width} × ${selected.height}` : "识别中"}</strong></div>
                <div><span>{selected.kind === "text" ? "文本行数" : selected.kind === "link" ? "链接协议" : selected.kind === "audio" ? "读取状态" : "画质等级"}</span><strong>{selected.kind === "text" ? `${(selected.textContent ?? "").split(/\r?\n/).length} 行` : selected.kind === "link" ? selected.linkUrl?.startsWith("https://") ? "HTTPS" : "HTTP" : selected.kind === "audio" ? selected.status === "ready" ? "可播放" : selected.status === "unsupported" ? "格式不支持" : "识别中" : resolutionLabel(selected.width, selected.height)}</strong></div>
                <div><span>文件大小</span><strong>{formatBytes(selected.size)}</strong></div>
                <div><span>{selected.kind === "video" || selected.kind === "audio" ? "素材时长" : selected.kind === "text" || selected.kind === "link" ? "素材类型" : "画面方向"}</span><strong>{selected.kind === "video" || selected.kind === "audio" ? formatDuration(selected.duration) : selected.kind === "text" ? "纯文本" : selected.kind === "link" ? "网页链接" : orientationLabel(selected.width, selected.height)}</strong></div>
              </div>

              {selected.kind === "link" && (
                <>
                  <div className="module-heading prompt-heading"><span>链接描述</span><b>DESCRIPTION</b></div>
                  <div className="prompt-section link-description-section">
                    <textarea
                      value={selected.textContent ?? ""}
                      onChange={(event) => updateAsset(selected.id, {
                        textContent: event.target.value,
                        size: new Blob([linkShortcut(selected.linkUrl ?? "")]).size,
                      })}
                      placeholder="在这里记录链接用途、内容说明或使用备注…"
                      aria-label="链接描述信息"
                      spellCheck={false}
                    />
                    <div className="prompt-footer">
                      <span>自动保存到本机</span>
                      <strong>{(selected.textContent ?? "").length} 字符</strong>
                      <i>LINK</i>
                    </div>
                  </div>
                </>
              )}

              {(selected.kind === "image" || selected.kind === "video") && (
                <>
                  <div className="module-heading prompt-heading"><span>提示词</span><b>PROMPT</b></div>
                  <div className="prompt-section">
                    <textarea
                      value={selected.prompt}
                      onChange={(event) => updatePrompt(event.target.value)}
                      placeholder="记录画面描述、镜头要求或生成提示词…"
                      aria-label="提示词"
                      spellCheck={false}
                    />
                    <div className="prompt-footer">
                      <span>素材比例</span>
                      <strong>{ratioLabel(selected.width, selected.height)}</strong>
                      <i>{orientationLabel(selected.width, selected.height)}</i>
                    </div>
                  </div>
                </>
              )}

              {previewOpen && (
                <div className={`viewer-overlay ${selected.kind}-viewer-overlay`} role="dialog" aria-modal="true" aria-label={`${selected.name} 素材预览`} onClick={() => setPreviewOpen(false)}>
                  <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
                    <div className="viewer-header">
                      <div>
                        <span>PREVIEW MODE</span>
                        <strong>{selected.name}</strong>
                      </div>
                      <div className="viewer-header-meta">
                        <span>{selected.kind === "text" ? `${(selected.textContent ?? "").length} 字符` : selected.kind === "audio" ? formatDuration(selected.duration) : selected.status === "unsupported" ? "格式不支持" : selected.width && selected.height ? `${selected.width} × ${selected.height}` : "识别中"}</span>
                        <span>{selected.kind === "text" ? "TEXT" : selected.kind === "audio" ? "AUDIO" : ratioLabel(selected.width, selected.height)}</span>
                        <button onClick={() => setPreviewOpen(false)} aria-label="关闭素材预览">×</button>
                      </div>
                    </div>
                    <div
                      ref={viewerCanvasRef}
                      className={`viewer-canvas ${selected.kind === "image" && viewerZoom > 100 ? "can-pan" : ""} ${isViewerPanning ? "panning" : ""}`}
                      title={selected.kind === "image" ? "Ctrl + 滚轮缩放；放大后按住鼠标拖动画面" : selected.kind === "text" ? "文本阅读模式" : selected.kind === "audio" ? "音频试听模式" : "按住 Ctrl 并滚动鼠标滚轮缩放"}
                      onPointerDown={(event) => beginPan(event, "viewer")}
                      onPointerMove={(event) => movePan(event, "viewer")}
                      onPointerUp={(event) => endPan(event, "viewer")}
                      onPointerCancel={(event) => endPan(event, "viewer")}
                    >
                      {selected.kind === "text" ? (
                        <article className="viewer-text-document">
                          <span>TEXT DOCUMENT</span>
                          <h2>{selected.name}</h2>
                          <pre>{selected.textContent || "空白文本"}</pre>
                        </article>
                      ) : selected.kind === "audio" ? (
                        <section className="viewer-audio-document">
                          <AudioArtwork />
                          <div>
                            <span>AUDIO PREVIEW</span>
                            <h2>{selected.name}</h2>
                            <p>{selected.extension} · {formatBytes(selected.size)} · {formatDuration(selected.duration)}</p>
                          </div>
                          <audio
                            key={`viewer-${selected.id}`}
                            src={selected.url}
                            controls
                            preload="metadata"
                            onLoadedMetadata={(event) => syncAudioMetadata(selected.id, event.currentTarget)}
                          />
                        </section>
                      ) : selected.kind === "video" ? (
                        <video
                          key={`viewer-${selected.id}`}
                          src={selected.url}
                          controls
                          style={{ transform: `scale(${viewerZoom / 100})` }}
                        />
                      ) : (
                        <img
                          key={`viewer-${selected.id}`}
                          src={selected.url}
                          alt={selected.name}
                          style={{ transform: `translate3d(${viewerPan.x}px, ${viewerPan.y}px, 0) scale(${viewerZoom / 100})` }}
                          draggable={false}
                        />
                      )}
                    </div>
                    {selected.kind === "text" ? (
                      <div className="viewer-toolbar text-viewer-toolbar">
                        <span>TEXT</span>
                        <button onClick={copySelectedText}>复制文本</button>
                        <i />
                        <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(selected.textContent ?? "")}`} download={selected.name}>↓ 下载文本</a>
                        <small>ESC 关闭</small>
                      </div>
                    ) : selected.kind === "audio" ? (
                      <div className="viewer-toolbar audio-viewer-toolbar">
                        <span>AUDIO</span>
                        <strong>{formatDuration(selected.duration)}</strong>
                        <i />
                        <a href={selected.url} download={selected.name}>↓ 下载音频</a>
                        <small>ESC 关闭</small>
                      </div>
                    ) : (
                      <div className="viewer-toolbar">
                        <span>ZOOM</span>
                        <button aria-label="大预览缩小" onClick={() => setViewerZoom((value) => Math.max(25, value - 25))}>−</button>
                        <button className="viewer-zoom-value" onClick={() => { setViewerZoom(100); setViewerPan({ x: 0, y: 0 }); }}>{viewerZoom}%</button>
                        <button aria-label="大预览放大" onClick={() => setViewerZoom((value) => Math.min(400, value + 25))}>＋</button>
                        <span className="viewer-wheel-hint"><kbd>Ctrl</kbd> + 滚轮缩放{selected.kind === "image" && viewerZoom > 100 ? " · 按住拖动" : ""}</span>
                        <i />
                        <a href={selected.url} download={selected.name}>↓ 下载素材</a>
                        <small>ESC 关闭</small>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-inspector">
              <div className="scanner-plate"><i /><i /><span>＋</span></div>
              <strong>等待选择素材</strong>
              <p>点击中间的素材卡片，在这里查看内容、预览与参数信息。</p>
            </div>
          )) : selectedPrompt ? (
            <div className="prompt-inspector">
              <div className="prompt-inspector-kicker">
                <span>{promptKindLabels[selectedPrompt.kind]}</span>
                <div>
                  <button aria-label={favoritePromptIds.includes(selectedPrompt.id) ? "取消收藏当前提示词" : "收藏当前提示词"} onClick={() => togglePromptFavorite(selectedPrompt.id)}>{favoritePromptIds.includes(selectedPrompt.id) ? "★ 已收藏" : "☆ 收藏"}</button>
                  <b>#{String(selectedPrompt.index).padStart(2, "0")}</b>
                </div>
              </div>
              <h3>{selectedPrompt.title}</h3>
              <p className="prompt-inspector-description">{activePromptCategory?.description}</p>

              <div className="prompt-hero" style={{ "--prompt-hue": selectedPrompt.hue } as React.CSSProperties}>
                <span>{selectedPrompt.kind === "image" ? "IMAGE" : selectedPrompt.kind === "video" ? "VIDEO" : "TEXT"}</span>
                <strong>{selectedPrompt.categoryName}</strong>
                <small>{selectedPrompt.ratio}</small>
              </div>

              <div className="prompt-detail-meta">
                <div><span>分类</span><strong>{selectedPrompt.categoryName}</strong></div>
                <div><span>序号</span><strong>{selectedPrompt.index} / 80</strong></div>
                <div><span>类型</span><strong>{promptKindLabels[selectedPrompt.kind]}</strong></div>
                <div><span>画幅</span><strong>{selectedPrompt.ratio}</strong></div>
              </div>

              <div className="module-heading prompt-heading"><span>本地提示词模板</span><b>{promptDrafts[selectedPrompt.id] !== undefined ? "PERSONAL DRAFT" : "ORIGINAL"}</b></div>
              <textarea
                className="prompt-library-text"
                value={selectedPromptText}
                onChange={(event) => {
                  const value = event.target.value;
                  setPromptDrafts((current) => ({ ...current, [selectedPrompt.id]: value }));
                  setRecentPromptIds((current) => [selectedPrompt.id, ...current.filter((item) => item !== selectedPrompt.id)].slice(0, 40));
                }}
                aria-label="提示词模板内容"
              />
              <div className="prompt-action-row">
                <button className="primary-prompt-action" onClick={copyPrompt}>复制提示词</button>
                <button
                  disabled={!selectedId}
                  onClick={() => {
                    if (!selectedId) return;
                    updateAsset(selectedId, { prompt: selectedPromptText });
                    selectPrompt(selectedPrompt.id);
                    setNotice("已写入当前选中素材");
                    window.setTimeout(() => setNotice(""), 1600);
                  }}
                >写入当前素材</button>
                <button
                  className="reset-prompt-action"
                  disabled={promptDrafts[selectedPrompt.id] === undefined}
                  onClick={() => setPromptDrafts((current) => {
                    const next = { ...current };
                    delete next[selectedPrompt.id];
                    return next;
                  })}
                >恢复原始模板</button>
              </div>
              <div className="prompt-tags-detail">
                {selectedPrompt.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <a className="prompt-source-link" href={selectedPrompt.sourceUrl} target="_blank" rel="noreferrer">查看分类参考来源 ↗</a>
            </div>
          ) : null}
        </aside>
      </section>

      {isAiStudioOpen && typeof document !== "undefined" && createPortal((
        <div
          className="ai-studio-overlay"
          role="presentation"
        >
          <section
            className="ai-studio-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-studio-title"
          >
            <header className="ai-studio-header">
              <div>
                <span>NEW.BI CREATION GATEWAY</span>
                <h3 id="ai-studio-title">AI 素材生成</h3>
                <p>选择模型、输入提示词，生成结果会自动保存进本机素材库。</p>
              </div>
              <button
                type="button"
                disabled={aiBusy}
                onClick={() => setIsAiStudioOpen(false)}
                aria-label="关闭 AI 生成窗口"
              >×</button>
            </header>

            <div className="ai-studio-scroll">
              <section className="ai-studio-section">
                <div className="ai-section-heading">
                  <span>01</span>
                  <div><strong>选择模型</strong><small>图片与视频分别使用独立密钥组</small></div>
                </div>
                <div className="ai-model-grid">
                  {AI_MODEL_OPTIONS.map((option) => {
                    const configured = aiConfig?.models.find((model) => model.id === option.id)?.available === true;
                    return (
                      <button
                        type="button"
                        key={option.id}
                        className={`ai-model-card ${aiModel === option.id ? "active" : ""}`}
                        style={{ "--ai-accent": option.accent } as CSSProperties}
                        onClick={() => {
                          setAiModel(option.id);
                          if (option.id === "minimax-h3" && aiVideoDuration < 5) setAiVideoDuration(5);
                          setAiError("");
                          setAiGeneration(null);
                        }}
                      >
                        <span className="ai-model-family">{option.family}</span>
                        <strong>{option.label}</strong>
                        <small>{option.detail}</small>
                        <i className={configured ? "ready" : "missing"}>{configured ? "已配置" : "待配置"}</i>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="ai-studio-section">
                <div className="ai-section-heading">
                  <span>02</span>
                  <div><strong>描述画面</strong><small>不会自动重试，避免重复计费</small></div>
                </div>
                <textarea
                  className="ai-prompt-input"
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                  placeholder={selectedAiOption.kind === "image"
                    ? "例如：雨夜霓虹街道中的电影感人物肖像，柔和侧光，细腻皮肤质感…"
                    : "例如：一名旅人站在海边悬崖，风吹动外套，镜头缓慢环绕，电影感自然光…"}
                  rows={5}
                  maxLength={aiPromptMaximum}
                  disabled={aiBusy || aiTaskActive}
                />
                <div className="ai-prompt-meta"><span>{aiPrompt.length} / {aiPromptMaximum}</span><span>当前：{selectedAiOption.label}</span></div>
              </section>

              <section className="ai-studio-section">
                <div className="ai-section-heading">
                  <span>03</span>
                  <div><strong>生成参数</strong><small>模型不支持的参数不会发送</small></div>
                </div>
                {selectedAiOption.kind === "image" ? (
                  <div className="ai-parameter-grid">
                    <label>
                      <span>画布尺寸</span>
                      <select value={aiImageSize} onChange={(event) => setAiImageSize(event.target.value)} disabled={aiBusy || aiTaskActive}>
                        <option value="1024x1024">1:1 · 1024 × 1024</option>
                        <option value="1536x1024">3:2 · 1536 × 1024</option>
                        <option value="1024x1536">2:3 · 1024 × 1536</option>
                      </select>
                    </label>
                    <label>
                      <span>生成质量</span>
                      <select value={aiImageQuality} onChange={(event) => setAiImageQuality(event.target.value)} disabled={aiBusy || aiTaskActive}>
                        <option value="low">快速</option>
                        <option value="medium">标准</option>
                        <option value="high">高质量</option>
                      </select>
                    </label>
                  </div>
                ) : (
                  <div className="ai-parameter-grid">
                    <label>
                      <span>视频时长</span>
                      <select value={aiVideoDuration} onChange={(event) => setAiVideoDuration(Number(event.target.value))} disabled={aiBusy || aiTaskActive}>
                        {(aiModel === "minimax-h3" ? [5, 6, 8, 10, 12, 15] : [4, 5, 6, 8, 10, 12, 15]).map((seconds) => (
                          <option key={seconds} value={seconds}>{seconds} 秒</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>画面比例</span>
                      <select value={aiVideoRatio} onChange={(event) => setAiVideoRatio(event.target.value)} disabled={aiBusy || aiTaskActive}>
                        <option value="16:9">横屏 16:9</option>
                        <option value="9:16">竖屏 9:16</option>
                        <option value="1:1">方形 1:1</option>
                      </select>
                    </label>
                    {aiModel === "seedance-2" && (
                      <label className="ai-toggle-parameter" aria-label="生成音频">
                        <span><strong>生成音频</strong><small>由模型同步生成画面声音</small></span>
                        <input type="checkbox" checked={aiGenerateAudio} onChange={(event) => setAiGenerateAudio(event.target.checked)} disabled={aiBusy || aiTaskActive} />
                      </label>
                    )}
                  </div>
                )}
                <div className="ai-cost-line"><span>本次预估</span><strong>{aiEstimatedCost}</strong><small>最终以 New.bi 账单为准</small></div>
              </section>

              {aiConfig?.accessTokenRequired && (
                <section className="ai-studio-section ai-access-section">
                  <div className="ai-section-heading">
                    <span>04</span>
                    <div><strong>工作台访问口令</strong><small>只保存在当前浏览器会话，不写入仓库</small></div>
                  </div>
                  <input
                    type="password"
                    value={aiAccessToken}
                    onChange={(event) => setAiAccessToken(event.target.value)}
                    placeholder="输入 MEDIA_DESK_AI_ACCESS_TOKEN"
                    autoComplete="off"
                    disabled={aiBusy || aiTaskActive}
                  />
                </section>
              )}

              {aiConfigLoading && <div className="ai-config-notice">正在读取本机 AI 配置…</div>}
              {!aiConfigLoading && aiConfig?.publicDisabled && (
                <div className="ai-config-notice warning">
                  线上 AI 接口已安全停用。部署时需要同时配置服务端密钥和工作台访问口令。
                </div>
              )}
              {!aiConfigLoading && aiConfig && !aiModelAvailable && !aiConfig.publicDisabled && (
                <div className="ai-config-notice warning">
                  {selectedAiOption.label} 尚未配置服务端密钥。请按仓库中的 <code>.dev.vars.example</code> 在本机创建 <code>.dev.vars</code>，密钥不会进入 Git。
                </div>
              )}
              {!aiConfigLoading && !aiConfig && aiError && <div className="ai-config-notice warning">AI 服务配置暂时不可用。</div>}

              {(aiGeneration || aiMessage || aiError) && (
                <div className={`ai-generation-status ${aiError ? "failure" : aiGeneration?.status === "succeeded" ? "success" : ""}`} role="status">
                  <span className="ai-status-icon" aria-hidden="true">{aiError ? "!" : aiGeneration?.status === "succeeded" ? "✓" : "↻"}</span>
                  <div>
                    <strong>{aiError ? "请求未完成" : aiGeneration?.status === "succeeded" ? "生成完成" : "任务处理中"}</strong>
                    <p>{aiError || aiMessage}</p>
                    {aiGeneration?.taskId && <small>任务编号：{aiGeneration.taskId}</small>}
                  </div>
                  {aiTaskActive && (
                    <button type="button" onClick={() => setAiPollingPaused((paused) => !paused)}>
                      {aiPollingPaused ? "继续查询" : "暂停查询"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <footer className="ai-studio-footer">
              <p><span>▣</span> New.bi API Key 仅由 Worker 读取，浏览器和仓库都看不到。</p>
              <div>
                <button type="button" disabled={aiBusy} onClick={() => setIsAiStudioOpen(false)}>
                  {aiGeneration?.status === "succeeded" ? "查看已保存素材" : "取消"}
                </button>
                <button type="button" className="primary" disabled={!aiCanSubmit} onClick={() => void submitAiGeneration()}>
                  {aiBusy ? "处理中…" : aiTaskActive ? "任务进行中" : `生成 ${selectedAiOption.kind === "image" ? "图片" : "视频"}`}
                </button>
              </div>
            </footer>
          </section>
        </div>
      ), document.body)}

      {backupDialogMode && (
        <div className="backup-overlay" role="presentation" onClick={closeBackupDialog}>
          <section
            className="backup-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>LOCAL VAULT TRANSFER</span>
                <h3 id="backup-dialog-title">{backupDialogMode === "export" ? "导出整库备份" : "恢复素材库"}</h3>
                <p>{backupDialogMode === "export" ? "素材、类目与提示词会保存为一个私人备份文件。" : "选择 .framevault 文件，把旧电脑中的内容恢复到本机。"}</p>
              </div>
              <button disabled={isBackupWorking} onClick={closeBackupDialog} aria-label="关闭备份窗口">×</button>
            </header>

            {backupDialogMode === "export" ? (
              <>
                <div className="backup-summary-grid">
                  <div><span>素材数量</span><strong>{assets.length} 个</strong></div>
                  <div><span>自定义类目</span><strong>{assetCategories.length} 个</strong></div>
                  <div><span>素材总大小</span><strong>{formatBytes(totalSize)}</strong></div>
                  <div><span>保存范围</span><strong>完整本地库</strong></div>
                </div>
                <div className="backup-safety-note">
                  <i>♡</i>
                  <p>备份只会下载到你选择的位置，不会上传到仓库或网络。文件中包含原始素材，请妥善保管。</p>
                </div>
              </>
            ) : (
              <>
                <div
                  className={`backup-drop-zone ${backupCandidate ? "ready" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void prepareBackupFile(event.dataTransfer.files[0]);
                  }}
                >
                  <span>{backupCandidate ? "✓" : "⇧"}</span>
                  <strong>{backupCandidate ? backupCandidateName : "把 .framevault 文件拖到这里"}</strong>
                  <small>{backupCandidate ? `${backupCandidate.manifest.assetCount} 个素材 · ${formatBytes(backupCandidate.manifest.totalBytes)}` : "或者从电脑中选择备份文件"}</small>
                  <button
                    disabled={isBackupWorking}
                    onClick={() => {
                      if (!backupInputRef.current) return;
                      backupInputRef.current.value = "";
                      backupInputRef.current.click();
                    }}
                  >{backupCandidate ? "重新选择" : "选择备份文件"}</button>
                  <input
                    ref={backupInputRef}
                    className="visually-hidden"
                    type="file"
                    accept=".framevault,application/x-framevault"
                    onChange={(event) => void prepareBackupFile(event.target.files?.[0])}
                  />
                </div>

                <div className="restore-mode-options" aria-label="恢复方式">
                  <label className={restoreMode === "merge" ? "active" : ""}>
                    <input type="radio" name="restore-mode" checked={restoreMode === "merge"} onChange={() => { setRestoreMode("merge"); setReplaceConfirmed(false); }} />
                    <span><strong>安全合并</strong><small>保留本机内容，只添加备份中不重复的素材。</small></span>
                  </label>
                  <label className={restoreMode === "replace" ? "active danger" : ""}>
                    <input type="radio" name="restore-mode" checked={restoreMode === "replace"} onChange={() => setRestoreMode("replace")} />
                    <span><strong>完全恢复</strong><small>清空当前本地库，恢复为备份文件中的状态。</small></span>
                  </label>
                </div>
                {restoreMode === "replace" && (
                  <label className="replace-confirmation">
                    <input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} />
                    <span>我确认覆盖本机当前的 {assets.length} 个素材</span>
                  </label>
                )}
              </>
            )}

            {(backupMessage || backupFailure) && (
              <div className={`backup-status ${backupFailure ? "failure" : ""}`} role="status">
                <i>{backupFailure ? "!" : isBackupWorking ? "…" : "✓"}</i>
                <span>{backupFailure || backupMessage}</span>
              </div>
            )}

            <footer>
              <small>{backupDialogMode === "export" ? "备份文件不会进入 Git 仓库" : "支持拖放导入 · 恢复完成后自动刷新"}</small>
              <button disabled={isBackupWorking} onClick={closeBackupDialog}>取消</button>
              {backupDialogMode === "export" ? (
                <button className="primary" disabled={isBackupWorking} onClick={() => void exportWorkspaceBackup()}>{isBackupWorking ? "正在生成…" : "导出备份"}</button>
              ) : (
                <button
                  className={restoreMode === "replace" ? "primary danger" : "primary"}
                  disabled={!backupCandidate || isBackupWorking || (restoreMode === "replace" && !replaceConfirmed)}
                  onClick={() => void restoreWorkspaceBackup()}
                >
                  {isBackupWorking ? "正在恢复…" : restoreMode === "replace" ? "完全恢复" : "合并到本机"}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {migrationDialogMode && (
        <div className="backup-overlay" role="presentation" onClick={closeMigrationDialog}>
          <section className="backup-dialog migration-dialog" role="dialog" aria-modal="true" aria-labelledby="migration-dialog-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>ENCRYPTED DEVICE TRANSFER</span>
                <h3 id="migration-dialog-title">{migrationDialogMode === "export" ? "导出加密迁移包" : "导入加密迁移包"}</h3>
                <p>{migrationDialogMode === "export" ? "使用 AES-256-GCM 在本机加密素材、分类、提示词和 .dev.vars 配置。" : "输入迁移密码，解密并恢复素材，同时下载其中的 .dev.vars 配置。"}</p>
              </div>
              <button disabled={isMigrationWorking} onClick={closeMigrationDialog} aria-label="关闭迁移窗口">×</button>
            </header>

            {migrationDialogMode === "export" ? (
              <div className="migration-fields">
                <label>
                  <span>.dev.vars 配置</span>
                  <textarea value={migrationDevVars} onChange={(event) => setMigrationDevVars(event.target.value)} placeholder={'NEWBI_BASE_URL="https://api.new.bi"\nNEWBI_IMAGE_API_KEY="..."\nNEWBI_VIDEO_GROUP_API_KEY="..."'} spellCheck={false} autoComplete="off" disabled={isMigrationWorking} />
                  <small>请从项目根目录的 .dev.vars 复制；内容只在当前浏览器内存中处理。</small>
                </label>
                <div className="migration-password-grid">
                  <label><span>迁移密码</span><input type="password" value={migrationPassword} onChange={(event) => setMigrationPassword(event.target.value)} minLength={8} autoComplete="new-password" disabled={isMigrationWorking} /></label>
                  <label><span>确认迁移密码</span><input type="password" value={migrationPasswordConfirm} onChange={(event) => setMigrationPasswordConfirm(event.target.value)} minLength={8} autoComplete="new-password" disabled={isMigrationWorking} /></label>
                </div>
                <div className="backup-safety-note"><i>⌾</i><p>密码不会保存，也无法找回。迁移包采用 PBKDF2-SHA-256（310,000 次）派生密钥，并使用 AES-256-GCM 认证加密。</p></div>
                {totalSize > 1024 ** 3 && <div className="backup-safety-note warning"><i>!</i><p>当前素材约 {formatBytes(totalSize)}，加密时浏览器需要临时占用额外内存；超过 1.5 GB 会被阻止。大体积素材建议使用外部硬盘目录迁移。</p></div>}
              </div>
            ) : (
              <div className="migration-fields">
                <label><span>迁移密码</span><input type="password" value={migrationPassword} onChange={(event) => { setMigrationPassword(event.target.value); setMigrationCandidate(null); setMigrationDevVars(""); }} minLength={8} autoComplete="current-password" disabled={isMigrationWorking} /></label>
                <div className={`backup-drop-zone ${migrationCandidate ? "ready" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void prepareMigrationFile(event.dataTransfer.files[0]); }}>
                  <span>{migrationCandidate ? "✓" : "⇧"}</span>
                  <strong>{migrationCandidate ? migrationCandidateName : "选择 .framevault-migration 文件"}</strong>
                  <small>{migrationCandidate ? `${migrationCandidate.backup.manifest.assetCount} 个素材 · ${formatBytes(migrationCandidate.backup.manifest.totalBytes)}` : "先输入密码，再选择或拖入加密迁移包"}</small>
                  <button disabled={isMigrationWorking || migrationPassword.length < 8} onClick={() => { if (!migrationInputRef.current) return; migrationInputRef.current.value = ""; migrationInputRef.current.click(); }}>{migrationCandidate ? "重新选择" : "选择迁移包"}</button>
                  <input ref={migrationInputRef} className="visually-hidden" type="file" accept=".framevault-migration,application/x-framevault-migration" onChange={(event) => void prepareMigrationFile(event.target.files?.[0])} />
                </div>
                {migrationCandidate && <div className="backup-safety-note"><i>✓</i><p>素材将安全合并到当前本地库，不覆盖同编号素材。恢复后浏览器会下载 .dev.vars，请将其放到项目根目录并重启服务。</p></div>}
              </div>
            )}

            {(migrationMessage || migrationFailure) && <div className={`backup-status ${migrationFailure ? "failure" : ""}`} role="status"><i>{migrationFailure ? "!" : isMigrationWorking ? "…" : "✓"}</i><span>{migrationFailure || migrationMessage}</span></div>}
            <footer>
              <small>{migrationDialogMode === "export" ? "加密在本机完成 · 不会上传密钥" : "外部硬盘目录仍需在新电脑重新授权"}</small>
              <button disabled={isMigrationWorking} onClick={closeMigrationDialog}>取消</button>
              {migrationDialogMode === "export" ? (
                <button className="primary" disabled={isMigrationWorking || migrationPassword.length < 8 || !migrationDevVars.trim()} onClick={() => void exportEncryptedMigration()}>{isMigrationWorking ? "正在加密…" : "生成加密迁移包"}</button>
              ) : (
                <button className="primary" disabled={isMigrationWorking || !migrationCandidate} onClick={() => void restoreEncryptedMigration()}>{isMigrationWorking ? "正在恢复…" : "安全合并并下载配置"}</button>
              )}
            </footer>
          </section>
        </div>
      )}

      {categoryPendingDelete && (
        <div className="category-delete-overlay" role="dialog" aria-modal="true" aria-label="删除类目确认" onClick={() => setCategoryPendingDelete(null)}>
          <div className="category-delete-dialog" onClick={(event) => event.stopPropagation()}>
            <span>DELETE CATEGORY</span>
            <h3>删除“{categoryPendingDelete}”？</h3>
            <p>
                类目中的 {assets.filter((asset) => asset.collection === "category" && asset.category === categoryPendingDelete).length} 个素材不会删除，
              会自动移到“未分类”。
            </p>
            <div>
              <button onClick={() => setCategoryPendingDelete(null)}>取消</button>
              <button className="danger" onClick={deleteAssetCategory}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {isAddingText && (
        <div
          className="text-create-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="新建文本素材"
          onClick={() => setIsAddingText(false)}
        >
          <div className="text-create-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="text-create-heading">
              <div><span>NEW TEXT ASSET</span><h3>新建文本素材</h3></div>
              <button onClick={() => setIsAddingText(false)} aria-label="关闭新建文本窗口">×</button>
            </div>
            <label>
              <span>文本名称</span>
              <input
                autoFocus
                value={textTitleDraft}
                maxLength={80}
                placeholder="例如：镜头说明、旁白文案"
                onChange={(event) => setTextTitleDraft(event.target.value)}
              />
            </label>
            <label>
              <span>文本内容</span>
              <textarea
                value={textContentDraft}
                placeholder="在这里输入需要保存的文本…"
                onChange={(event) => setTextContentDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") addTextAsset();
                }}
                spellCheck={false}
              />
            </label>
            <div className="text-create-meta">
              <span>保存到：{filter.startsWith("category:") ? filter.slice("category:".length) : "素材库根目录"}</span>
              <b>{textContentDraft.length} 字符</b>
            </div>
            <div className="text-create-actions">
              <small>Ctrl + Enter 快速保存</small>
              <button onClick={() => setIsAddingText(false)}>取消</button>
              <button className="primary" disabled={!textContentDraft.trim()} onClick={addTextAsset}>保存文本</button>
            </div>
          </div>
        </div>
      )}

      {isAddingLink && (
        <div
          className="text-create-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="添加链接素材"
          onClick={() => setIsAddingLink(false)}
        >
          <div className="text-create-dialog link-create-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="text-create-heading">
              <div><span>NEW LINK ASSET</span><h3>添加链接素材</h3></div>
              <button onClick={() => setIsAddingLink(false)} aria-label="关闭添加链接窗口">×</button>
            </div>
            <label>
              <span>链接名称</span>
              <input
                autoFocus
                value={linkTitleDraft}
                maxLength={80}
                placeholder="例如：项目主页、参考资料"
                onChange={(event) => setLinkTitleDraft(event.target.value)}
              />
            </label>
            <label>
              <span>链接地址</span>
              <input
                value={linkUrlDraft}
                inputMode="url"
                placeholder="https://example.com"
                onChange={(event) => setLinkUrlDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") addLinkAsset();
                }}
              />
            </label>
            <div className="text-create-meta">
              <span>保存到：{filter.startsWith("category:") ? filter.slice("category:".length) : "素材库根目录"}</span>
              <b>{normalizeLinkUrl(linkUrlDraft) ? "链接有效" : "等待有效网址"}</b>
            </div>
            <div className="text-create-actions">
              <small>Ctrl + Enter 快速保存</small>
              <button onClick={() => setIsAddingLink(false)}>取消</button>
              <button className="primary" disabled={!normalizeLinkUrl(linkUrlDraft)} onClick={addLinkAsset}>保存链接</button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
