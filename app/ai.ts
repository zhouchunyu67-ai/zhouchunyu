export type AiModelId = "gpt-image-2" | "seedream-5" | "minimax-h3" | "seedance-2" | "seedance-2-5";
export type AiAssetKind = "image" | "video";
export type AiGenerationStatus = "queued" | "running" | "succeeded" | "failed";

export type AiModelConfig = {
  id: AiModelId;
  label: string;
  kind: AiAssetKind;
  providerModel: string;
  available: boolean;
};

export type AiConfig = {
  baseUrl: string;
  accessTokenRequired: boolean;
  publicDisabled: boolean;
  models: AiModelConfig[];
};

export type AiGeneratedAsset = {
  kind: AiAssetKind;
  mimeType: string;
  fileName: string;
  dataUrl?: string;
  downloadUrl?: string;
};

export type AiReferenceKind = "image" | "video" | "audio";

export type AiReferenceUpload = {
  id: string;
  kind: AiReferenceKind;
  tag: string;
  file: File;
};

export type AiGeneration = {
  model: AiModelId;
  providerModel: string;
  status: AiGenerationStatus;
  taskId?: string;
  rawStatus?: string;
  assets?: AiGeneratedAsset[];
};

export type CreateAiGenerationInput = {
  model: AiModelId;
  prompt: string;
  parameters: {
    size?: string;
    ratio?: string;
    resolution?: "1K" | "2K" | "4K" | "720P" | "768P";
    quality?: string;
    format?: "png" | "jpeg" | "webp";
    duration?: number;
    generateAudio?: boolean;
  };
};

type AiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export class AiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "AI_REQUEST_FAILED", status = 500) {
    super(message);
    this.name = "AiRequestError";
    this.code = code;
    this.status = status;
  }
}

function headers(accessToken?: string): HeadersInit {
  return accessToken ? { "x-media-desk-token": accessToken } : {};
}

async function readJson<T>(response: Response): Promise<T> {
  let payload: T | AiErrorPayload;
  try {
    payload = await response.json() as T | AiErrorPayload;
  } catch {
    throw new AiRequestError("服务返回了无法识别的内容。", "INVALID_RESPONSE", response.status);
  }
  if (!response.ok) {
    const error = (payload as AiErrorPayload).error;
    throw new AiRequestError(error?.message ?? "AI 服务请求失败。", error?.code, response.status);
  }
  return payload as T;
}

export async function loadAiConfig(): Promise<AiConfig> {
  const response = await fetch("/api/ai/config", { cache: "no-store" });
  return readJson<AiConfig>(response);
}

export async function createAiGeneration(
  input: CreateAiGenerationInput,
  accessToken?: string,
  references: AiReferenceUpload[] = [],
): Promise<AiGeneration> {
  const requestHeaders = headers(accessToken);
  let body: BodyInit;
  let combinedHeaders: HeadersInit;
  if (references.length) {
    const form = new FormData();
    form.append("payload", JSON.stringify(input));
    form.append("referenceMeta", JSON.stringify(references.map(({ id, kind, tag, file }) => ({
      id,
      kind,
      tag,
      name: file.name,
    }))));
    references.forEach(({ file }) => form.append("reference", file, file.name));
    body = form;
    combinedHeaders = requestHeaders;
  } else {
    body = JSON.stringify(input);
    combinedHeaders = { "content-type": "application/json", ...requestHeaders };
  }
  const response = await fetch("/api/ai/generations", {
    method: "POST",
    headers: combinedHeaders,
    body,
  });
  return readJson<AiGeneration>(response);
}

export async function queryAiGeneration(
  model: AiModelId,
  taskId: string,
  accessToken?: string,
): Promise<AiGeneration> {
  const response = await fetch(`/api/ai/generations/${encodeURIComponent(model)}/${encodeURIComponent(taskId)}`, {
    cache: "no-store",
    headers: headers(accessToken),
  });
  return readJson<AiGeneration>(response);
}

export async function downloadAiAsset(asset: AiGeneratedAsset, accessToken?: string): Promise<File> {
  const source = asset.dataUrl ?? asset.downloadUrl;
  if (!source) throw new AiRequestError("生成结果缺少下载地址。", "MISSING_ASSET_URL");
  const response = await fetch(source, { headers: source.startsWith("/api/ai/") ? headers(accessToken) : {} });
  if (!response.ok) throw new AiRequestError("生成结果下载失败，请稍后重试。", "ASSET_DOWNLOAD_FAILED", response.status);
  const blob = await response.blob();
  const mimeType = blob.type || asset.mimeType;
  return new File([blob], asset.fileName, { type: mimeType });
}
