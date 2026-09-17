import assert from "node:assert/strict";
import test from "node:test";

import { handleNewBiRequest } from "../worker/newbi.ts";

const jsonRequest = (url, body, headers = {}) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const multipartRequest = (url, body, references) => {
  const form = new FormData();
  form.append("payload", JSON.stringify(body));
  form.append("referenceMeta", JSON.stringify(references.map((reference, index) => ({
    id: `reference-${index + 1}`,
    kind: reference.kind,
    tag: `@${reference.kind}${index + 1}`,
    name: reference.file.name,
  }))));
  references.forEach((reference) => form.append("reference", reference.file, reference.file.name));
  return new Request(url, { method: "POST", body: form });
};

test("config reports model availability without exposing keys", async () => {
  const response = await handleNewBiRequest(
    new Request("http://localhost/api/ai/config"),
    { NEWBI_IMAGE_API_KEY: "image-secret", NEWBI_SEEDREAM_API_KEY: "seedream-secret", NEWBI_VIDEO_GROUP_API_KEY: "video-secret" },
  );
  assert.equal(response.status, 200);
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.equal(Object.hasOwn(payload, "accessTokenRequired"), false);
  assert.equal(Object.hasOwn(payload, "publicDisabled"), false);
  assert.equal(payload.models.length, 6);
  assert.ok(payload.models.some((model) => model.id === "pixverse-mimic"));
  assert.ok(payload.models.every((model) => model.available));
  assert.doesNotMatch(text, /image-secret|video-secret/);
});

test("placeholder API keys are unavailable and never sent upstream", async () => {
  let called = false;
  const env = {
    NEWBI_IMAGE_API_KEY: "replace-with-your-image-group-key",
    NEWBI_SEEDREAM_API_KEY: "your-seedream-key",
    NEWBI_VIDEO_GROUP_API_KEY: "placeholder",
  };
  const configResponse = await handleNewBiRequest(new Request("http://localhost/api/ai/config"), env);
  const config = await configResponse.json();
  assert.ok(config.models.every((model) => model.available === false));

  const response = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", { model: "gpt-image-2", prompt: "test" }),
    env,
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "MODEL_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("production generation can use the configured New.bi key without a workbench access token", async () => {
  const response = await handleNewBiRequest(
    jsonRequest("https://desk.example/api/ai/generations", { model: "gpt-image-2", prompt: "test" }),
    { NEWBI_IMAGE_API_KEY: "image-secret" },
    async () => new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] })),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "succeeded");
});

test("allowlist rejects unknown models before making an upstream request", async () => {
  let called = false;
  const response = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", { model: "not-allowed", prompt: "test" }),
    { NEWBI_IMAGE_API_KEY: "image-secret" },
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal((await response.json()).error.code, "UNSUPPORTED_MODEL");
});

test("GPT Image 2 uses the image endpoint and returns an importable data URL", async () => {
  let requestUrl = "";
  let requestInit;
  const response = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", {
      model: "gpt-image-2",
      prompt: "a paper crane",
      parameters: { size: "1024x1024", quality: "high", format: "webp" },
    }),
    { NEWBI_IMAGE_API_KEY: "image-secret" },
    async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), {
        headers: { "content-type": "application/json" },
      });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(requestUrl, "https://api.new.bi/v1/images/generations");
  assert.equal(requestInit.headers.authorization, "Bearer image-secret");
  assert.equal(JSON.parse(requestInit.body).model, "gpt-image-2-d");
  assert.equal(JSON.parse(requestInit.body).output_format, "webp");
  const payload = await response.json();
  assert.equal(payload.status, "succeeded");
  assert.match(payload.assets[0].dataUrl, /^data:image\/webp;base64,/);
});

test("GPT Image 2 switches to multipart edits when reference images are supplied", async () => {
  let requestUrl = "";
  let upstreamForm;
  const response = await handleNewBiRequest(
    multipartRequest(
      "http://localhost/api/ai/generations",
      { model: "gpt-image-2", prompt: "keep the character and change the background", parameters: { ratio: "3:2", resolution: "1K" } },
      [{ kind: "image", file: new File(["image"], "character.png", { type: "image/png" }) }],
    ),
    { NEWBI_IMAGE_API_KEY: "image-secret" },
    async (url, init) => {
      requestUrl = String(url);
      upstreamForm = init.body;
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
    },
  );
  assert.equal(response.status, 200);
  assert.equal(requestUrl, "https://api.new.bi/v1/images/edits");
  assert.ok(upstreamForm instanceof FormData);
  assert.equal(upstreamForm.get("model"), "gpt-image-2-d");
  assert.equal(upstreamForm.getAll("image").length, 1);
});

test("GPT Image 2 maps every visual ratio choice to a concrete output size", async () => {
  let body;
  const response = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", {
      model: "gpt-image-2",
      prompt: "ultrawide skyline",
      parameters: { ratio: "21:9", resolution: "2K" },
    }),
    { NEWBI_IMAGE_API_KEY: "image-secret" },
    async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
    },
  );
  assert.equal(response.status, 200);
  assert.equal(body.size, "2560x1097");
});

test("MiniMax H3 task creation and status polling use the video-group key", async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("query/video_generation")) {
      return new Response(JSON.stringify({ status: "Success", video_url: "https://cdn.example/generated.mp4" }));
    }
    return new Response(JSON.stringify({ task_id: "h3-task-123" }));
  };
  const env = { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" };
  const created = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", {
      model: "minimax-h3",
      prompt: "waves rolling over black sand",
      parameters: { duration: 8, ratio: "16:9" },
    }),
    env,
    fetchMock,
  );
  assert.equal(created.status, 200);
  assert.equal((await created.json()).taskId, "h3-task-123");

  const queried = await handleNewBiRequest(
    new Request("http://localhost/api/ai/generations/minimax-h3/h3-task-123"),
    env,
    fetchMock,
  );
  assert.equal(queried.status, 200);
  const payload = await queried.json();
  assert.equal(payload.status, "succeeded");
  assert.match(payload.assets[0].downloadUrl, /^\/api\/ai\/result\?token=/);
  assert.doesNotMatch(payload.assets[0].downloadUrl, /cdn\.example/);
  assert.equal(calls[0].init.headers.authorization, "Bearer video-secret");
  assert.equal(calls[0].url, "https://api.new.bi/minimax/v1/video_generation");
  assert.match(calls[1].url, /query\/video_generation\?task_id=h3-task-123$/);
});

test("MiniMax H3 forwards image, video and audio references as multimodal content", async () => {
  let body;
  const response = await handleNewBiRequest(
    multipartRequest("http://localhost/api/ai/generations", { model: "minimax-h3", prompt: "test" }, [
      { kind: "image", file: new File(["image"], "a.png", { type: "image/png" }) },
      { kind: "video", file: new File(["video"], "b.mp4", { type: "video/mp4" }) },
      { kind: "audio", file: new File(["audio"], "c.mp3", { type: "audio/mpeg" }) },
    ]),
    { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" },
    async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ id: "h3-multi" })); },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body.content.map((item) => item.type), ["text", "image_url", "video_url", "audio_url"]);
});

test("PixVerse Mimic requires one image and one motion video and forwards both", async () => {
  let body;
  const response = await handleNewBiRequest(
    multipartRequest("http://localhost/api/ai/generations", { model: "pixverse-mimic", prompt: "copy the motion" }, [
      { kind: "image", file: new File(["image"], "person.png", { type: "image/png" }) },
      { kind: "video", file: new File(["video"], "motion.mp4", { type: "video/mp4" }) },
    ]),
    { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" },
    async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ id: "mimic-task" })); },
  );
  assert.equal(response.status, 200);
  assert.equal(body.model, "pixverse-mimic");
  assert.deepEqual(body.content.map((item) => item.type), ["text", "image_url", "video_url"]);
  assert.equal(body.content[1].role, "target_image");
  assert.equal(body.content[2].role, "reference_video");
});

test("Seedream 5 uses the Ark-compatible image route, dedicated key and priced provider model", async () => {
  let requestUrl = "";
  let requestInit;
  let body;
  const response = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", {
      model: "seedream-5",
      prompt: "soft morning light",
      parameters: { ratio: "9:16", resolution: "4K" },
    }),
    { NEWBI_SEEDREAM_API_KEY: "seedream-secret" },
    async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }));
    },
  );
  assert.equal(response.status, 200);
  assert.equal(requestUrl, "https://api.new.bi/v1/images/generations");
  assert.equal(body.model, "doubao-seedream-5-0-260128");
  assert.equal(requestInit.headers.authorization, "Bearer seedream-secret");
  assert.equal(body.size, "4K");
  assert.match(body.prompt, /画幅比例 9:16/);
  assert.notEqual(body.size, "2304x4096");
});

test("New.bi validation errors are returned without exposing credential-like values", async () => {
  const response = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", {
      model: "seedream-5",
      prompt: "test",
      parameters: { ratio: "9:16", resolution: "4K" },
    }),
    { NEWBI_SEEDREAM_API_KEY: "seedream-secret" },
    async () => new Response(JSON.stringify({
      error: { message: "Invalid size; Authorization Bearer sk-examplecredential123456789012345678" },
    }), { status: 400 }),
  );
  assert.equal(response.status, 502);
  const text = await response.text();
  const payload = JSON.parse(text);
  assert.equal(payload.error.code, "NEWBI_REQUEST_FAILED");
  assert.match(payload.error.message, /Invalid size/);
  assert.doesNotMatch(text, /sk-examplecredential|seedream-secret/);
});

test("Seedance 2 uses content-task creation and polling routes", async () => {
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith("/seedance-task-456")
      ? new Response(JSON.stringify({ status: "succeeded", video_url: "https://cdn.example/seedance.mp4" }))
      : new Response(JSON.stringify({ id: "seedance-task-456" }));
  };
  const env = { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" };
  const created = await handleNewBiRequest(
    jsonRequest("http://localhost/api/ai/generations", {
      model: "seedance-2",
      prompt: "camera follows a running fox",
      parameters: { duration: 6, ratio: "9:16", generateAudio: true },
    }),
    env,
    fetchMock,
  );
  assert.equal(created.status, 200);
  assert.equal(calls[0].url, "https://api.new.bi/api/v3/contents/generations/tasks");
  const createBody = JSON.parse(calls[0].init.body);
  assert.equal(createBody.model, "doubao-seedance-2-0-260128");
  assert.equal(createBody.generate_audio, true);

  const queried = await handleNewBiRequest(
    new Request("http://localhost/api/ai/generations/seedance-2/seedance-task-456"),
    env,
    fetchMock,
  );
  assert.equal(queried.status, 200);
  assert.equal((await queried.json()).status, "succeeded");
  assert.equal(calls[1].url, "https://api.new.bi/api/v3/contents/generations/tasks/seedance-task-456");
});

test("Seedance 2 forwards local image, video and audio references as typed data URLs", async () => {
  let body;
  const response = await handleNewBiRequest(
    multipartRequest(
      "http://localhost/api/ai/generations",
      { model: "seedance-2", prompt: "use @图片1 with @视频1 and @音频1", parameters: { duration: 8, ratio: "21:9", generateAudio: true } },
      [
        { kind: "image", file: new File(["image"], "image.png", { type: "image/png" }) },
        { kind: "video", file: new File(["video"], "motion.mp4", { type: "video/mp4" }) },
        { kind: "audio", file: new File(["audio"], "music.mp3", { type: "audio/mpeg" }) },
      ],
    ),
    { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" },
    async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "seedance-multimodal-1" }));
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body.content.map((item) => item.type), ["text", "image_url", "video_url", "audio_url"]);
  assert.match(body.content[1].image_url.url, /^data:image\/png;base64,/);
  assert.match(body.content[2].video_url.url, /^data:video\/mp4;base64,/);
  assert.match(body.content[3].audio_url.url, /^data:audio\/mpeg;base64,/);
  assert.equal(body.ratio, "21:9");
});

test("Seedance 2.5 uses sd-2-5 and accepts every whole-second duration through 30 seconds", async () => {
  let body;
  const response = await handleNewBiRequest(
    multipartRequest(
      "http://localhost/api/ai/generations",
      { model: "seedance-2-5", prompt: "use @图片1 and @音频1", parameters: { duration: 30, ratio: "3:2", generateAudio: true } },
      [
        { kind: "image", file: new File(["image"], "image.png", { type: "image/png" }) },
        { kind: "audio", file: new File(["audio"], "music.mp3", { type: "audio/mpeg" }) },
      ],
    ),
    { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" },
    async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "seedance-25-task" }));
    },
  );
  assert.equal(response.status, 200);
  assert.equal(body.model, "sd-2-5");
  assert.equal(body.duration, 30);
  assert.equal(body.ratio, "3:2");
  assert.deepEqual(body.content.map((item) => item.type), ["text", "image_url", "audio_url"]);
});

test("Seedance 2.5 rejects reference video before New.bi enables it", async () => {
  let called = false;
  const response = await handleNewBiRequest(
    multipartRequest(
      "http://localhost/api/ai/generations",
      { model: "seedance-2-5", prompt: "test" },
      [{ kind: "video", file: new File(["video"], "motion.mp4", { type: "video/mp4" }) }],
    ),
    { NEWBI_VIDEO_GROUP_API_KEY: "video-secret" },
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal((await response.json()).error.code, "INCOMPATIBLE_REFERENCE");
});

test("image-only models reject audio and video references before upstream billing", async () => {
  let called = false;
  const response = await handleNewBiRequest(
    multipartRequest(
      "http://localhost/api/ai/generations",
      { model: "seedream-5", prompt: "test" },
      [{ kind: "audio", file: new File(["audio"], "music.mp3", { type: "audio/mpeg" }) }],
    ),
    { NEWBI_SEEDREAM_API_KEY: "seedream-secret" },
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
  assert.equal((await response.json()).error.code, "INCOMPATIBLE_REFERENCE");
});
