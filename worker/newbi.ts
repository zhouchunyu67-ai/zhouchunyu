export type NewBiEnv = {
  NEWBI_BASE_URL?: string;
  NEWBI_IMAGE_API_KEY?: string;
  NEWBI_SEEDREAM_API_KEY?: string;
  NEWBI_VIDEO_GROUP_API_KEY?: string;
  NEWBI_MODEL_GPT_IMAGE_2?: string;
  NEWBI_MODEL_SEEDREAM_5?: string;
  NEWBI_MODEL_MINIMAX_H3?: string;
  NEWBI_MODEL_PIXVERSE_MIMIC?: string;
  NEWBI_MODEL_SEEDANCE_2?: string;
  NEWBI_MODEL_SEEDANCE_2_5?: string;
};

type LogicalModelId = "gpt-image-2" | "seedream-5" | "minimax-h3" | "pixverse-mimic" | "seedance-2" | "seedance-2-5";
type CredentialKind = "image" | "seedream" | "video-group";
type GenerationStatus = "queued" | "running" | "succeeded" | "failed";

type ModelDefinition = {
  id: LogicalModelId;
  label: string;
  kind: "image" | "video";
  credential: CredentialKind;
  defaultProviderModel: string;
  modelEnvKey:
    | "NEWBI_MODEL_GPT_IMAGE_2"
    | "NEWBI_MODEL_SEEDREAM_5"
    | "NEWBI_MODEL_MINIMAX_H3"
    | "NEWBI_MODEL_PIXVERSE_MIMIC"
    | "NEWBI_MODEL_SEEDANCE_2"
    | "NEWBI_MODEL_SEEDANCE_2_5";
};

type GeneratedAsset = {
  kind: "image" | "video";
  mimeType: string;
  fileName: string;
  dataUrl?: string;
  downloadUrl?: string;
};

type ReferenceKind = "image" | "video" | "audio";

type ReferenceUpload = {
  id: string;
  kind: ReferenceKind;
  tag: string;
  fileName: string;
  file: File;
};

type ResultTokenPayload = {
  url: string;
  fileName: string;
  mimeType: string;
  expiresAt: number;
};

type JsonRecord = Record<string, unknown>;

const API_KEY_PLACEHOLDER_PATTERN = /replace-with-|your-[\w-]*-key|placeholder/i;

const MODEL_DEFINITIONS: Record<LogicalModelId, ModelDefinition> = {
  "gpt-image-2": {
    id: "gpt-image-2",
    label: "GPT Image 2",
    kind: "image",
    credential: "image",
    defaultProviderModel: "gpt-image-2-d",
    modelEnvKey: "NEWBI_MODEL_GPT_IMAGE_2",
  },
  "seedream-5": {
    id: "seedream-5",
    label: "Seedream 5.0",
    kind: "image",
    credential: "seedream",
    defaultProviderModel: "doubao-seedream-5-0-260128",
    modelEnvKey: "NEWBI_MODEL_SEEDREAM_5",
  },
  "minimax-h3": {
    id: "minimax-h3",
    label: "MiniMax H3",
    kind: "video",
    credential: "video-group",
    defaultProviderModel: "minimax-h3-768p",
    modelEnvKey: "NEWBI_MODEL_MINIMAX_H3",
  },
  "pixverse-mimic": {
    id: "pixverse-mimic",
    label: "PixVerse Mimic",
    kind: "video",
    credential: "video-group",
    defaultProviderModel: "pixverse-mimic",
    modelEnvKey: "NEWBI_MODEL_PIXVERSE_MIMIC",
  },
  "seedance-2": {
    id: "seedance-2",
    label: "Seedance 2.0",
    kind: "video",
    credential: "video-group",
    defaultProviderModel: "doubao-seedance-2-0-260128",
    modelEnvKey: "NEWBI_MODEL_SEEDANCE_2",
  },
  "seedance-2-5": {
    id: "seedance-2-5",
    label: "Seedance 2.5",
    kind: "video",
    credential: "video-group",
    defaultProviderModel: "sd-2-5",
    modelEnvKey: "NEWBI_MODEL_SEEDANCE_2_5",
  },
};

const IMAGE_SIZES = new Set([
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
  "auto",
]);
const IMAGE_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const SEEDREAM_RESOLUTIONS = new Set(["1K", "2K", "4K"]);
const VIDEO_RATIOS = new Set(["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"]);
const REFERENCE_LIMITS: Record<ReferenceKind, number> = {
  image: 10 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 30 * 1024 * 1024,
};
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;
const IMAGE_DIMENSIONS: Record<string, Record<string, string>> = {
  "1K": { "1:1": "1024x1024", "16:9": "1536x864", "9:16": "864x1536", "4:3": "1152x864", "3:4": "864x1152", "3:2": "1536x1024", "2:3": "1024x1536", "21:9": "1536x658" },
  "2K": { "1:1": "2048x2048", "16:9": "2560x1440", "9:16": "1440x2560", "4:3": "2304x1728", "3:4": "1728x2304", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "2560x1097" },
  "4K": { "1:1": "4096x4096", "16:9": "4096x2304", "9:16": "2304x4096", "4:3": "4096x3072", "3:4": "3072x4096", "3:2": "4096x2731", "2:3": "2731x4096", "21:9": "4096x1755" },
};
const SUCCESS_STATUSES = new Set(["success", "succeeded", "completed", "complete", "finished", "done"]);
const FAILURE_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled", "expired"]);
const encoder = new TextEncoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function baseUrl(env: NewBiEnv): string {
  const configured = getString(env.NEWBI_BASE_URL) ?? "https://api.new.bi";
  return configured.replace(/\/+$/, "");
}

function getModelDefinition(value: unknown): ModelDefinition | undefined {
  return typeof value === "string" ? MODEL_DEFINITIONS[value as LogicalModelId] : undefined;
}

function providerModel(definition: ModelDefinition, env: NewBiEnv): string {
  return getString(env[definition.modelEnvKey]) ?? definition.defaultProviderModel;
}

function apiKeyFor(definition: ModelDefinition, env: NewBiEnv): string | undefined {
  if (definition.credential === "image") return getString(env.NEWBI_IMAGE_API_KEY);
  if (definition.credential === "seedream") return getString(env.NEWBI_SEEDREAM_API_KEY);
  return getString(env.NEWBI_VIDEO_GROUP_API_KEY);
}

function isPlaceholderApiKey(value: string | undefined): boolean {
  return Boolean(value && API_KEY_PLACEHOLDER_PATTERN.test(value));
}

function missingCredentialMessage(definition: ModelDefinition, apiKey: string | undefined): string {
  return isPlaceholderApiKey(apiKey)
    ? `${definition.label} 的 New.bi 密钥仍是示例占位符。请在 .dev.vars 填入真实密钥并重启服务。`
    : `${definition.label} 尚未配置可用的 New.bi 密钥。`;
}

function requestConfig(env: NewBiEnv): Response {
  const models = Object.values(MODEL_DEFINITIONS).map((definition) => {
    const apiKey = apiKeyFor(definition, env);
    return {
      id: definition.id,
      label: definition.label,
      kind: definition.kind,
      providerModel: providerModel(definition, env),
      available: Boolean(apiKey) && !isPlaceholderApiKey(apiKey),
    };
  });
  return json({
    baseUrl: baseUrl(env),
    models,
  });
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function safeFileName(value: string): string {
  const printable = Array.from(value, (character) => character.charCodeAt(0) < 32 ? "-" : character).join("");
  const cleaned = printable.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || "ai-generated-asset";
}

class UpstreamRequestError extends Error {
  status: number;
  detail?: string;

  constructor(status: number, detail?: string) {
    super(`UPSTREAM_${status}`);
    this.name = "UpstreamRequestError";
    this.status = status;
    this.detail = detail;
  }
}

class UpstreamInvalidJsonError extends Error {
  detail?: string;

  constructor(detail?: string) {
    super("UPSTREAM_INVALID_JSON");
    this.name = "UpstreamInvalidJsonError";
    this.detail = detail;
  }
}

function safeNonJsonSnippet(text: string): string | undefined {
  if (!text.trim()) return undefined;
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, "[script]")
    .replace(/<style[\s\S]*?<\/style>/gi, "[style]")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/\b(?:sk-|key-)?[A-Za-z0-9_-]{28,}\b/g, "[已隐藏]")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || undefined;
}

function safeUpstreamErrorDetail(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    const candidate = isRecord(parsed) && isRecord(parsed.error)
      ? getString(parsed.error.message) ?? getString(parsed.error.detail) ?? getString(parsed.error.code)
      : isRecord(parsed)
        ? getString(parsed.message) ?? getString(parsed.detail) ?? getString(parsed.msg)
        : undefined;
    if (!candidate) return undefined;
    return candidate
      .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
      .replace(/\b(?:sk-|key-)?[A-Za-z0-9_-]{28,}\b/g, "[已隐藏]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240) || undefined;
  } catch {
    return undefined;
  }
}

async function readUpstreamJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new UpstreamRequestError(response.status, safeUpstreamErrorDetail(text));
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const contentType = response.headers.get("content-type") ?? undefined;
    const isHtml = Boolean(contentType && contentType.toLowerCase().includes("text/html"));
    const detail = [
      isHtml ? "上游返回了 HTML 页面而非 JSON，通常是请求路径不存在、被网关兜底到网页" : undefined,
      contentType ? `content-type: ${contentType}` : undefined,
      safeNonJsonSnippet(text),
    ].filter(Boolean).join("；");
    throw new UpstreamInvalidJsonError(detail || "响应体为空或不是 JSON");
  }
}

async function upstreamFetch(
  path: string,
  init: RequestInit,
  apiKey: string,
  env: NewBiEnv,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const isMultipart = typeof FormData !== "undefined" && init.body instanceof FormData;
  const response = await fetchImpl(`${baseUrl(env)}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(init.body && !isMultipart ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(120_000),
  });
  return readUpstreamJson(response);
}

function referenceKind(file: File): ReferenceKind | undefined {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return undefined;
}

async function readGenerationRequest(request: Request): Promise<{
  body?: JsonRecord;
  references: ReferenceUpload[];
  failure?: Response;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    try {
      const parsed = await request.json();
      if (!isRecord(parsed)) throw new Error("invalid");
      return { body: parsed, references: [] };
    } catch {
      return { references: [], failure: errorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。") };
    }
  }

  try {
    const form = await request.formData();
    const parsed = JSON.parse(String(form.get("payload") ?? "")) as unknown;
    const parsedMeta = JSON.parse(String(form.get("referenceMeta") ?? "[]")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsedMeta)) throw new Error("invalid");
    const files = form.getAll("reference").filter((entry): entry is File => entry instanceof File);
    if (files.length !== parsedMeta.length || files.length > 50) {
      return { references: [], failure: errorResponse(400, "INVALID_REFERENCES", "参考素材数量无效，最多可以添加 50 个。") };
    }
    let totalBytes = 0;
    const references: ReferenceUpload[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const meta = isRecord(parsedMeta[index]) ? parsedMeta[index] : {};
      const kind = referenceKind(file);
      if (!kind) return { references: [], failure: errorResponse(400, "UNSUPPORTED_REFERENCE", "参考素材只支持图片、音频或视频。") };
      if (file.size > REFERENCE_LIMITS[kind]) {
        const limit = Math.round(REFERENCE_LIMITS[kind] / 1024 / 1024);
        return { references: [], failure: errorResponse(413, "REFERENCE_TOO_LARGE", `${kind === "image" ? "图片" : kind === "audio" ? "音频" : "视频"}参考不能超过 ${limit} MB。`) };
      }
      totalBytes += file.size;
      references.push({
        id: getString(meta.id) ?? `reference-${index + 1}`,
        kind,
        tag: getString(meta.tag) ?? `@素材${index + 1}`,
        fileName: safeFileName(file.name || `reference-${index + 1}`),
        file,
      });
    }
    if (totalBytes > MAX_REFERENCE_BYTES) {
      return { references: [], failure: errorResponse(413, "REFERENCES_TOO_LARGE", "参考素材总大小不能超过 50 MB。") };
    }
    return { body: parsed, references };
  } catch {
    return { references: [], failure: errorResponse(400, "INVALID_MULTIPART", "无法读取参考素材，请重新选择后再试。") };
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}

function requestedImageSize(parameters: JsonRecord, fallback: string): string {
  const explicit = getString(parameters.size);
  if (explicit && IMAGE_SIZES.has(explicit)) return explicit;
  const resolution = getString(parameters.resolution) ?? "2K";
  const ratio = getString(parameters.ratio) ?? "1:1";
  return IMAGE_DIMENSIONS[resolution]?.[ratio] ?? fallback;
}

function requestedSeedreamResolution(parameters: JsonRecord): string {
  const resolution = getString(parameters.resolution);
  return resolution && SEEDREAM_RESOLUTIONS.has(resolution) ? resolution : "2K";
}

function requestedSeedreamPrompt(prompt: string, parameters: JsonRecord): string {
  const ratio = getString(parameters.ratio);
  return ratio && VIDEO_RATIOS.has(ratio)
    ? `${prompt}\n生成要求：画幅比例 ${ratio}。`
    : prompt;
}

function validateReferences(definition: ModelDefinition, references: ReferenceUpload[]): Response | undefined {
  if (!references.length) return undefined;
  if ((definition.id === "gpt-image-2" || definition.id === "seedream-5") && references.some((reference) => reference.kind !== "image")) {
    return errorResponse(400, "INCOMPATIBLE_REFERENCE", `${definition.label} 当前只接受参考图片。`);
  }
  if (definition.id === "minimax-h3" && references.some((reference) => !["image", "video", "audio"].includes(reference.kind))) {
    return errorResponse(400, "INCOMPATIBLE_REFERENCE", "MiniMax H3 支持图片、视频和音频参考。");
  }
  if (definition.id === "pixverse-mimic") {
    const imageCount = references.filter((reference) => reference.kind === "image").length;
    const videoCount = references.filter((reference) => reference.kind === "video").length;
    if (references.some((reference) => reference.kind === "audio") || imageCount !== 1 || videoCount !== 1 || references.length !== 2) {
      return errorResponse(400, "INCOMPATIBLE_REFERENCE", "PixVerse Mimic requires one character image and one motion reference video.");
    }
  }
  if (definition.id === "seedance-2-5") {
    const imageCount = references.filter((reference) => reference.kind === "image").length;
    const audioCount = references.filter((reference) => reference.kind === "audio").length;
    if (references.some((reference) => reference.kind === "video") || imageCount > 30 || audioCount > 10) {
      return errorResponse(400, "INCOMPATIBLE_REFERENCE", "Seedance 2.5 当前最多接受 30 张图片和 10 个音频；New.bi 暂未开放参考视频。");
    }
  }
  return undefined;
}

function findFirstString(root: unknown, keys: Set<string>): string | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown): string | undefined => {
    if (!value || typeof value !== "object" || seen.has(value)) return undefined;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = visit(item);
        if (result) return result;
      }
      return undefined;
    }
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      if (keys.has(key.toLowerCase())) {
        const result = getString(child);
        if (result) return result;
      }
    }
    for (const child of Object.values(value as JsonRecord)) {
      const result = visit(child);
      if (result) return result;
    }
    return undefined;
  };
  return visit(root);
}

function extractTaskId(value: unknown): string | undefined {
  return findFirstString(value, new Set(["task_id", "taskid", "id"]));
}

function extractRawStatus(value: unknown): string | undefined {
  return findFirstString(value, new Set(["task_status", "taskstatus", "status", "state"]));
}

function collectAssetCandidates(root: unknown): Array<{ url?: string; base64?: string; mimeType?: string }> {
  const results: Array<{ url?: string; base64?: string; mimeType?: string }> = [];
  const seenObjects = new Set<unknown>();
  const seenValues = new Set<string>();
  const visit = (value: unknown, parentKey = "") => {
    if (!value || typeof value !== "object" || seenObjects.has(value)) return;
    seenObjects.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, parentKey));
      return;
    }
    const record = value as JsonRecord;
    const mimeType = getString(record.mime_type) ?? getString(record.mimeType);
    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = key.toLowerCase();
      const stringValue = getString(child);
      if (stringValue && /^https:\/\//i.test(stringValue) && /(url|download|output|file|image|video|media)/i.test(normalizedKey)) {
        if (!seenValues.has(stringValue)) {
          seenValues.add(stringValue);
          results.push({ url: stringValue, mimeType });
        }
      } else if (stringValue && /(b64_json|base64|image_base64)/i.test(normalizedKey) && /^[a-z0-9+/=\r\n]+$/i.test(stringValue)) {
        if (!seenValues.has(stringValue)) {
          seenValues.add(stringValue);
          results.push({ base64: stringValue.replace(/\s+/g, ""), mimeType });
        }
      } else if (child && typeof child === "object") {
        visit(child, normalizedKey || parentKey);
      }
    }
  };
  visit(root);
  return results;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signResultToken(payload: ResultTokenPayload, apiKey: string): Promise<string> {
  const payloadPart = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", encoder.encode(apiKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadPart));
  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifyResultToken(token: string, env: NewBiEnv): Promise<ResultTokenPayload | undefined> {
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) return undefined;
  let payload: ResultTokenPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as ResultTokenPayload;
  } catch {
    return undefined;
  }
  if (!payload.url || !payload.fileName || !payload.mimeType || !Number.isFinite(payload.expiresAt)) return undefined;
  if (payload.expiresAt < Date.now() || payload.expiresAt > Date.now() + 2 * 60 * 60 * 1000) return undefined;
  try {
    const parsed = new URL(payload.url);
    if (parsed.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  const signature = base64UrlToBytes(signaturePart);
  const candidates = [
    getString(env.NEWBI_IMAGE_API_KEY),
    getString(env.NEWBI_SEEDREAM_API_KEY),
    getString(env.NEWBI_VIDEO_GROUP_API_KEY),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(candidate), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (await crypto.subtle.verify("HMAC", key, signature, encoder.encode(payloadPart))) return payload;
  }
  return undefined;
}

async function normalizeAssets(
  value: unknown,
  definition: ModelDefinition,
  apiKey: string,
): Promise<GeneratedAsset[]> {
  const candidates = collectAssetCandidates(value);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  return Promise.all(candidates.map(async (candidate, index) => {
    const fallbackMime = definition.kind === "video" ? "video/mp4" : "image/webp";
    const mimeType = candidate.mimeType ?? fallbackMime;
    const extension = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : mimeType.includes("video") ? "mp4" : "webp";
    const fileName = safeFileName(`AI-${definition.label.replace(/\s+/g, "-")}-${stamp}-${index + 1}.${extension}`);
    if (candidate.base64) {
      return { kind: definition.kind, mimeType, fileName, dataUrl: `data:${mimeType};base64,${candidate.base64}` };
    }
    const token = await signResultToken({
      url: candidate.url!,
      fileName,
      mimeType,
      expiresAt: Date.now() + 60 * 60 * 1000,
    }, apiKey);
    return { kind: definition.kind, mimeType, fileName, downloadUrl: `/api/ai/result?token=${encodeURIComponent(token)}` };
  }));
}

function normalizeStatus(value: unknown, hasAssets: boolean): GenerationStatus {
  if (hasAssets) return "succeeded";
  const status = extractRawStatus(value)?.toLowerCase();
  if (!status) return "running";
  if (SUCCESS_STATUSES.has(status)) return "succeeded";
  if (FAILURE_STATUSES.has(status)) return "failed";
  return status.includes("queue") || status.includes("submit") ? "queued" : "running";
}

async function createGeneration(
  request: Request,
  env: NewBiEnv,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const parsedRequest = await readGenerationRequest(request);
  if (parsedRequest.failure) return parsedRequest.failure;
  const body = parsedRequest.body!;
  const references = parsedRequest.references;

  const definition = getModelDefinition(body.model);
  if (!definition) return errorResponse(400, "UNSUPPORTED_MODEL", "该模型不在工作台允许列表中。");
  const referenceFailure = validateReferences(definition, references);
  if (referenceFailure) return referenceFailure;
  const prompt = getString(body.prompt);
  const maximumPromptLength = definition.id === "gpt-image-2" ? 1000 : 5000;
  if (!prompt || prompt.length > maximumPromptLength) {
    return errorResponse(400, "INVALID_PROMPT", `提示词不能为空，且不能超过 ${maximumPromptLength} 个字符。`);
  }
  const apiKey = apiKeyFor(definition, env);
  if (!apiKey || isPlaceholderApiKey(apiKey)) return errorResponse(503, "MODEL_NOT_CONFIGURED", missingCredentialMessage(definition, apiKey));
  const parameters = isRecord(body.parameters) ? body.parameters : {};
  const model = providerModel(definition, env);

  try {
    let result: unknown;
    if (definition.id === "gpt-image-2") {
      const quality = getString(parameters.quality);
      const format = getString(parameters.format);
      const size = requestedImageSize(parameters, "1024x1024");
      const outputFormat = format === "png" || format === "jpeg" || format === "webp" ? format : "webp";
      if (references.length) {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", prompt);
        form.append("n", "1");
        form.append("size", size);
        form.append("quality", quality && IMAGE_QUALITIES.has(quality) ? quality : "medium");
        form.append("output_format", outputFormat);
        references.forEach((reference) => form.append("image", reference.file, reference.fileName));
        result = await upstreamFetch("/v1/images/edits", { method: "POST", body: form }, apiKey, env, fetchImpl);
      } else {
        result = await upstreamFetch("/v1/images/generations", {
          method: "POST",
          body: JSON.stringify({
            model,
            prompt,
            n: 1,
            size,
            quality: quality && IMAGE_QUALITIES.has(quality) ? quality : "medium",
            output_format: outputFormat,
          }),
        }, apiKey, env, fetchImpl);
      }
    } else if (definition.id === "seedream-5") {
      const referenceImages = await Promise.all(references.map((reference) => fileToDataUrl(reference.file)));
      result = await upstreamFetch("/v1/images/generations", {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt: requestedSeedreamPrompt(prompt, parameters),
          ...(referenceImages.length ? { image: referenceImages.length === 1 ? referenceImages[0] : referenceImages } : {}),
          size: requestedSeedreamResolution(parameters),
          output_format: "png",
          response_format: "url",
          watermark: false,
        }),
      }, apiKey, env, fetchImpl);
    } else {
      // New.bi（new-api 网关）统一视频任务端点：提交 POST /v1/video/generations，
      // 之后用返回的任务 id 轮询 GET /v1/video/generations/{task_id}。
      // 注意：供应商原生路径（/minimax/v1/video_generation、/api/v3/contents/generations/tasks）
      // 在该网关上不存在，会被兜底返回 HTML 首页，导致 UPSTREAM_INVALID_JSON。
      const unsupportedReferences = references.filter((reference) => reference.kind !== "image");
      if (unsupportedReferences.length) {
        return errorResponse(400, "UNSUPPORTED_REFERENCE", "当前 New.bi 统一视频端点仅支持图片参考；音频/视频参考暂不支持，请移除后重试。");
      }
      const imageDataUrls = await Promise.all(references.map((reference) => fileToDataUrl(reference.file)));
      const ratio = getString(parameters.ratio);
      const resolution = definition.id === "minimax-h3" ? "768p" : getString(parameters.resolution);
      const duration = definition.id === "seedance-2-5"
        ? clampInteger(parameters.duration, 4, 30, 5)
        : definition.id === "minimax-h3"
          ? clampInteger(parameters.duration, 5, 15, 5)
          : clampInteger(parameters.duration, 4, 15, 5);
      const metadata: Record<string, unknown> = {
        ...(ratio && VIDEO_RATIOS.has(ratio) ? { ratio, aspect_ratio: ratio } : {}),
        ...(resolution ? { resolution } : {}),
        watermark: false,
      };
      if (imageDataUrls.length > 1) metadata.image_urls = imageDataUrls;
      result = await upstreamFetch("/v1/video/generations", {
        method: "POST",
        body: JSON.stringify({
          model,
          prompt,
          duration,
          ...(imageDataUrls.length === 1 ? { image: imageDataUrls[0] } : {}),
          metadata,
        }),
      }, apiKey, env, fetchImpl);
    }

    const assets = await normalizeAssets(result, definition, apiKey);
    if (assets.length) {
      return json({ model: definition.id, providerModel: model, status: "succeeded", assets });
    }
    const taskId = extractTaskId(result);
    if (!taskId) {
      return errorResponse(502, "UNRECOGNIZED_RESPONSE", "New.bi 已响应，但工作台无法识别任务编号或素材结果。请核对该模型的最新接口协议。");
    }
    return json({ model: definition.id, providerModel: model, status: "queued", taskId });
  } catch (error) {
    if (error instanceof UpstreamInvalidJsonError) {
      return errorResponse(502, "UPSTREAM_INVALID_JSON", `New.bi 返回了无法识别的响应${error.detail ? `（${error.detail}）` : "。"}`);
    }
    const message = error instanceof Error ? error.message : "UPSTREAM_ERROR";
    if (error instanceof UpstreamRequestError) {
      const detail = error.detail ? `：${error.detail}` : "";
      return errorResponse(error.status === 429 ? 429 : 502, "NEWBI_REQUEST_FAILED", `New.bi 调用失败（${error.status}）${detail}`);
    }
    if (message.startsWith("UPSTREAM_")) {
      const status = Number(message.slice("UPSTREAM_".length));
      return errorResponse(status === 401 || status === 403 ? 502 : status === 429 ? 429 : 502, "NEWBI_REQUEST_FAILED", `New.bi 调用失败${Number.isFinite(status) ? `（${status}）` : ""}，请检查密钥、模型分组和账户额度。`);
    }
    if (error instanceof DOMException && error.name === "TimeoutError") return errorResponse(504, "NEWBI_TIMEOUT", "New.bi 响应超时，未自动重试以避免重复扣费。");
    return errorResponse(502, "NEWBI_REQUEST_FAILED", "New.bi 调用失败，请稍后查看任务或使用日志。");
  }
}

async function queryGeneration(
  request: Request,
  modelId: string,
  taskId: string,
  env: NewBiEnv,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const definition = getModelDefinition(modelId);
  if (!definition || definition.kind !== "video") return errorResponse(400, "UNSUPPORTED_MODEL", "该视频模型不在工作台允许列表中。");
  if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(taskId)) return errorResponse(400, "INVALID_TASK_ID", "任务编号格式无效。");
  const apiKey = apiKeyFor(definition, env);
  if (!apiKey || isPlaceholderApiKey(apiKey)) return errorResponse(503, "MODEL_NOT_CONFIGURED", missingCredentialMessage(definition, apiKey));

  try {
    const result = await upstreamFetch(`/v1/video/generations/${encodeURIComponent(taskId)}`, { method: "GET" }, apiKey, env, fetchImpl);
    const assets = await normalizeAssets(result, definition, apiKey);
    const rawStatus = extractRawStatus(result);
    const status = normalizeStatus(result, assets.length > 0);

    if (status === "succeeded" && !assets.length) {
      return errorResponse(502, "RESULT_NOT_READY", "任务已完成，但暂未取得可下载的视频地址，请稍后再查一次。");
    }
    return json({ model: definition.id, providerModel: providerModel(definition, env), taskId, status, rawStatus, assets });
  } catch (error) {
    if (error instanceof UpstreamInvalidJsonError) {
      return errorResponse(502, "UPSTREAM_INVALID_JSON", `查询 New.bi 任务失败：返回了无法识别的响应${error.detail ? `（${error.detail}）` : ""}。`);
    }
    const message = error instanceof Error ? error.message : "UPSTREAM_ERROR";
    if (message.startsWith("UPSTREAM_")) {
      const status = Number(message.slice("UPSTREAM_".length));
      return errorResponse(status === 429 ? 429 : 502, "NEWBI_STATUS_FAILED", `查询 New.bi 任务失败${Number.isFinite(status) ? `（${status}）` : ""}。`);
    }
    return errorResponse(502, "NEWBI_STATUS_FAILED", "查询 New.bi 任务失败，请稍后重试。");
  }
}

async function proxySignedResult(request: Request, env: NewBiEnv, fetchImpl: typeof fetch): Promise<Response> {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const payload = await verifyResultToken(token, env);
  if (!payload) return errorResponse(403, "INVALID_RESULT_TOKEN", "下载链接无效或已经过期。");
  const response = await fetchImpl(payload.url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) return errorResponse(502, "RESULT_DOWNLOAD_FAILED", "生成结果下载失败，请返回任务页重试。");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 150 * 1024 * 1024) {
    return errorResponse(413, "RESULT_TOO_LARGE", "生成结果超过 150 MB，工作台拒绝下载。");
  }
  const upstreamType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const contentType = upstreamType && /^(image|video|audio)\//i.test(upstreamType) ? upstreamType : payload.mimeType;
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${safeFileName(payload.fileName)}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleNewBiRequest(
  request: Request,
  env: NewBiEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/ai/")) return undefined;
  if (url.pathname === "/api/ai/config" && request.method === "GET") return requestConfig(env);

  if (url.pathname === "/api/ai/generations" && request.method === "POST") {
    return createGeneration(request, env, fetchImpl);
  }
  if (url.pathname === "/api/ai/result" && request.method === "GET") {
    return proxySignedResult(request, env, fetchImpl);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (request.method === "GET" && parts.length === 5 && parts[0] === "api" && parts[1] === "ai" && parts[2] === "generations") {
    return queryGeneration(request, decodeURIComponent(parts[3]), decodeURIComponent(parts[4]), env, fetchImpl);
  }
  return errorResponse(404, "NOT_FOUND", "未找到该 AI 接口。");
}

export { MODEL_DEFINITIONS };
