"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteStoredAsset,
  loadStoredAssets,
  loadStoredPromptState,
  patchStoredAsset,
  saveStoredAsset,
  saveStoredPromptState,
  type StoredAssetRecord,
} from "./storage";
import {
  promptCategories,
  promptEntries,
  promptKindLabels,
  type PromptKind,
} from "./promptCatalog";

type AssetKind = "image" | "video";
type AssetStatus = "reading" | "ready" | "unsupported";
type Filter = "all" | AssetKind | `category:${string}`;
type WorkspaceMode = "assets" | "prompts";
type PromptScope = "category" | "favorites" | "recent";
type PanPoint = { x: number; y: number };
type PanDrag = PanPoint & { panX: number; panY: number };

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
  width?: number;
  height?: number;
  duration?: number;
  status: AssetStatus;
  prompt: string;
  category: string;
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
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    status: asset.status,
    prompt: asset.prompt,
    category: asset.category,
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

function inferKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif"].includes(extension ?? "")) return "image";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv", "mpeg", "mpg"].includes(extension ?? "")) return "video";
  return null;
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
  const [videoExpanded, setVideoExpanded] = useState(false);
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
  const [promptStateReady, setPromptStateReady] = useState(false);
  const [previewPan, setPreviewPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [viewerPan, setViewerPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [isPreviewPanning, setIsPreviewPanning] = useState(false);
  const [isViewerPanning, setIsViewerPanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewStageRef = useRef<HTMLDivElement>(null);
  const viewerCanvasRef = useRef<HTMLDivElement>(null);
  const assetsRef = useRef<MediaAsset[]>([]);
  const previewDragRef = useRef<PanDrag | null>(null);
  const viewerDragRef = useRef<PanDrag | null>(null);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => {
        URL.revokeObjectURL(asset.url);
        if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl);
      });
    };
  }, []);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  useEffect(() => {
    setZoom(100);
    setViewerZoom(100);
    setPreviewOpen(false);
    setVideoExpanded(false);
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
    if (!videoExpanded && !previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVideoExpanded(false);
        setPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoExpanded, previewOpen]);

  useEffect(() => {
    const preview = previewStageRef.current;
    if (!preview) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => Math.min(400, Math.max(25, value + (event.deltaY < 0 ? 10 : -10))));
    };
    preview.addEventListener("wheel", onWheel, { passive: false });
    return () => preview.removeEventListener("wheel", onWheel);
  }, [selectedId]);

  useEffect(() => {
    const canvas = viewerCanvasRef.current;
    if (!canvas || !previewOpen) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      setViewerZoom((value) => Math.min(400, Math.max(25, value + (event.deltaY < 0 ? 10 : -10))));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [previewOpen, selectedId]);

  const openPreview = () => {
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
            url: URL.createObjectURL(file),
            name: record.name,
            kind: record.kind,
            extension: record.extension,
            mime: record.mime,
            size: record.size,
            width: record.width,
            height: record.height,
            duration: record.duration,
            status: record.status,
            prompt: record.prompt,
            category: record.category ?? DEFAULT_ASSET_CATEGORY,
            createdAt: record.createdAt,
          };
        });
        setAssets(restored);
        setSelectedId(restored[0]?.id ?? null);
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

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted: MediaAsset[] = [];
    const activeCategory = filter.startsWith("category:")
      ? filter.slice("category:".length)
      : DEFAULT_ASSET_CATEGORY;
    let skipped = 0;
    Array.from(files).forEach((file) => {
      const kind = inferKind(file);
      if (!kind) {
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
        createdAt: Date.now() + accepted.length,
      });
    });

    if (accepted.length) {
      setAssets((current) => [...accepted, ...current]);
      if (!filter.startsWith("category:")) setFilter("all");
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
      setNotice(`已忽略 ${skipped} 个非图片或视频文件`);
      window.setTimeout(() => setNotice(""), 3200);
    }
  }, [filter, readMetadata]);

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
        URL.revokeObjectURL(target.url);
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
    const affectedAssets = assets.filter((asset) => asset.category === category);
    setAssets((current) => current.map((asset) => (
      asset.category === category ? { ...asset, category: DEFAULT_ASSET_CATEGORY } : asset
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

  const visibleAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesKind = filter === "all" || asset.kind === filter || filter.startsWith("category:");
      const matchesCategory = !filter.startsWith("category:") || asset.category === filter.slice(9);
      const matchesQuery = !keyword || asset.name.toLowerCase().includes(keyword) || asset.extension.toLowerCase().includes(keyword);
      return matchesKind && matchesCategory && matchesQuery;
    });
  }, [assets, filter, query]);

  const totalSize = useMemo(() => assets.reduce((sum, asset) => sum + asset.size, 0), [assets]);
  const imageCount = assets.filter((asset) => asset.kind === "image").length;
  const videoCount = assets.length - imageCount;
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
        <div className="local-status" title="文件不会上传至网络">
          <span className="status-dot" />
          SAVED LOCALLY
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="side-panel">
          <div className="side-title">
            <span>{workspaceMode === "assets" ? "素材收藏夹" : "提示词分类"}</span>
            <b>⌄</b>
          </div>
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
                  <b>{assets.length}</b>
                </button>
                <button className={filter === "video" ? "active" : ""} onClick={() => setFilter("video")}>
                  <span><i className="nav-symbol video-symbol" />视频</span>
                  <b>{videoCount}</b>
                </button>
                <button className={filter === "image" ? "active" : ""} onClick={() => setFilter("image")}>
                  <span><i className="nav-symbol image-symbol" />图片</span>
                  <b>{imageCount}</b>
                </button>
              </nav>

              <div className="side-divider" />
              <div className="custom-category-heading">
                <span>自定义类目</span>
                <button onClick={() => setIsAddingCategory((value) => !value)}>＋ 添加类目</button>
              </div>
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
                        <b>{assets.filter((asset) => asset.category === category).length}</b>
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

              <div className="side-divider compact-divider" />
              <div className="side-group-label">格式索引</div>
              <div className="format-index">
                <span>MP4</span><span>MOV</span><span>PNG</span><span>JPG</span><span>WEBM</span><span>HEIC</span>
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

          <div className="privacy-note">
            <span className="privacy-icon">◎</span>
            <div>
              <strong>本机持久保存</strong>
              <p>{workspaceMode === "assets" ? "素材与提示词会一直保留，只有手动移除才删除。" : "共 24 类、1,920 条本地整理模板，可离线搜索和复制。"}</p>
            </div>
          </div>
          <div className="node-status"><span>LOCAL DB</span><i /><b>PERSISTENT</b></div>
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
              <p>{isLoadingSaved ? "正在读取本机素材库…" : assets.length ? `${assets.length} 个素材 · ${formatBytes(totalSize)}` : "等待导入本地素材"}</p>
            </div>
            <div className="toolbar-actions">
              <label className="search-box">
                <i aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文件名或格式"
                  aria-label="搜索素材"
                />
                <kbd>⌘ K</kbd>
              </label>
              <button className="upload-button" onClick={() => inputRef.current?.click()}>
                <span aria-hidden="true">＋</span> 添加
              </button>
              <input
                ref={inputRef}
                className="visually-hidden"
                type="file"
                accept="image/*,video/*,.mkv,.avi,.heic,.heif"
                multiple
                onChange={onInputChange}
              />
            </div>
          </div>

          <div className="asset-grid" role="list">
            <button className="upload-tile" onClick={() => inputRef.current?.click()}>
              <span className="upload-tile-icon">✦</span>
              <strong>导入新素材</strong>
              <small>IMAGE / VIDEO · DROP HERE</small>
            </button>

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
                  {asset.kind === "image" ? (
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
                  <span className="type-badge">{asset.kind === "video" ? "VIDEO" : "IMAGE"}</span>
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
                  <div>
                    <span>{asset.extension}</span>
                    <span>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : "识别中"}</span>
                    {asset.kind === "video" && <span>{formatDuration(asset.duration)}</span>}
                  </div>
                </div>
                <div className="asset-card-footer">
                  <span>{ratioLabel(asset.width, asset.height)}</span>
                  <i />
                  <span>{formatBytes(asset.size)}</span>
                  <b>{orientationLabel(asset.width, asset.height)}</b>
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
              <p>点击左上方导入卡片，或拖入图片和视频。</p>
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
                <span>所属类目</span>
                <select value={selected.category} onChange={(event) => updateAsset(selected.id, { category: event.target.value })}>
                  {assetCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>

              <div className="module-heading preview-module-heading">
                <span>画面预览</span>
                <div><b>{selected.extension}</b><button onClick={openPreview}>预览 ↗</button></div>
              </div>
              <div
                ref={previewStageRef}
                className={`preview-stage ${selected.kind} ${videoExpanded ? "expanded" : ""} ${selected.kind === "image" && zoom > 100 ? "can-pan" : ""} ${isPreviewPanning ? "panning" : ""}`}
                title={selected.kind === "image" ? "Ctrl + 滚轮缩放；放大后按住鼠标拖动画面" : "按住 Ctrl 并滚动鼠标滚轮缩放"}
                onPointerDown={(event) => beginPan(event, "preview")}
                onPointerMove={(event) => movePan(event, "preview")}
                onPointerUp={(event) => endPan(event, "preview")}
                onPointerCancel={(event) => endPan(event, "preview")}
              >
                {selected.kind === "video" ? (
                  <>
                    <video
                      key={selected.id}
                      src={selected.url}
                      controls
                      preload="metadata"
                      style={{ transform: `scale(${zoom / 100})` }}
                      onLoadedMetadata={(event) => syncVideoMetadata(selected.id, event.currentTarget)}
                    />
                    {videoExpanded && (
                      <button className="exit-fullscreen" onClick={() => setVideoExpanded(false)} aria-label="退出全屏">×</button>
                    )}
                  </>
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
                <span className="preview-ratio">{ratioLabel(selected.width, selected.height)}</span>
                <button className="open-preview-float" onPointerDown={(event) => event.stopPropagation()} onClick={openPreview}>点开预览 ↗</button>
              </div>

              <div className="preview-controls">
                <span className="wheel-hint"><kbd>Ctrl</kbd> + 滚轮缩放{selected.kind === "image" && zoom > 100 ? " · 按住拖动" : ""}</span>
                <button aria-label="缩小预览" onClick={() => setZoom((value) => Math.max(25, value - 25))}>−</button>
                <button className="zoom-value" onClick={() => { setZoom(100); setPreviewPan({ x: 0, y: 0 }); }}>{zoom}%</button>
                <button aria-label="放大预览" onClick={() => setZoom((value) => Math.min(400, value + 25))}>＋</button>
                {selected.kind === "video" && <button onClick={() => setVideoExpanded(true)}><span>⛶</span> 全屏</button>}
                <a href={selected.url} download={selected.name} aria-label="下载素材">↓</a>
              </div>

              <div className="module-heading"><span>参数信息</span><b>METADATA</b></div>
              <div className="metadata-grid">
                <div><span>分辨率</span><strong>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : "识别中"}</strong></div>
                <div><span>画质等级</span><strong>{resolutionLabel(selected.width, selected.height)}</strong></div>
                <div><span>文件大小</span><strong>{formatBytes(selected.size)}</strong></div>
                <div><span>{selected.kind === "video" ? "素材时长" : "画面方向"}</span><strong>{selected.kind === "video" ? formatDuration(selected.duration) : orientationLabel(selected.width, selected.height)}</strong></div>
              </div>

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

              {previewOpen && (
                <div className="viewer-overlay" role="dialog" aria-modal="true" aria-label={`${selected.name} 大图预览`} onClick={() => setPreviewOpen(false)}>
                  <div className="viewer-shell" onClick={(event) => event.stopPropagation()}>
                    <div className="viewer-header">
                      <div>
                        <span>PREVIEW MODE</span>
                        <strong>{selected.name}</strong>
                      </div>
                      <div className="viewer-header-meta">
                        <span>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : "识别中"}</span>
                        <span>{ratioLabel(selected.width, selected.height)}</span>
                        <button onClick={() => setPreviewOpen(false)} aria-label="关闭大图预览">×</button>
                      </div>
                    </div>
                    <div
                      ref={viewerCanvasRef}
                      className={`viewer-canvas ${selected.kind === "image" && viewerZoom > 100 ? "can-pan" : ""} ${isViewerPanning ? "panning" : ""}`}
                      title={selected.kind === "image" ? "Ctrl + 滚轮缩放；放大后按住鼠标拖动画面" : "按住 Ctrl 并滚动鼠标滚轮缩放"}
                      onPointerDown={(event) => beginPan(event, "viewer")}
                      onPointerMove={(event) => movePan(event, "viewer")}
                      onPointerUp={(event) => endPan(event, "viewer")}
                      onPointerCancel={(event) => endPan(event, "viewer")}
                    >
                      {selected.kind === "video" ? (
                        <video
                          key={`viewer-${selected.id}`}
                          src={selected.url}
                          controls
                          autoPlay
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
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-inspector">
              <div className="scanner-plate"><i /><i /><span>＋</span></div>
              <strong>等待选择素材</strong>
              <p>点击中间的素材卡片，在这里查看画面、参数与提示词。</p>
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

      {categoryPendingDelete && (
        <div className="category-delete-overlay" role="dialog" aria-modal="true" aria-label="删除类目确认" onClick={() => setCategoryPendingDelete(null)}>
          <div className="category-delete-dialog" onClick={(event) => event.stopPropagation()}>
            <span>DELETE CATEGORY</span>
            <h3>删除“{categoryPendingDelete}”？</h3>
            <p>
              类目中的 {assets.filter((asset) => asset.category === categoryPendingDelete).length} 个素材不会删除，
              会自动移到“未分类”。
            </p>
            <div>
              <button onClick={() => setCategoryPendingDelete(null)}>取消</button>
              <button className="danger" onClick={deleteAssetCategory}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
