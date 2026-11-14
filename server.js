require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const maxImages = 3;
const maxImageBytes = 4 * 1024 * 1024;
const requestWindowMs = 10 * 60 * 1000;
const requestLimit = 12;
const requestCounts = new Map();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self)");
  next();
});
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

function isConfigured(provider) {
  const names = {
    gemini: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    sarvam: "SARVAM_API_KEY",
  };
  return Boolean(process.env[names[provider]]);
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    providers: {
      gemini: isConfigured("gemini"),
      groq: isConfigured("groq"),
      sarvam: isConfigured("sarvam"),
    },
  });
});

function checkRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const recent = (requestCounts.get(key) || []).filter((time) => now - time < requestWindowMs);
  if (recent.length >= requestLimit) {
    return res.status(429).json({ error: "Too many scans from this connection. Please try again in a few minutes." });
  }
  recent.push(now);
  requestCounts.set(key, recent);
  if (requestCounts.size > 1000) {
    for (const [ip, times] of requestCounts) {
      if (!times.some((time) => now - time < requestWindowMs)) requestCounts.delete(ip);
    }
  }
  next();
}

function parseImage(image) {
  if (!image || typeof image.dataUrl !== "string") return null;
  const match = image.dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const data = match[2];
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > maxImageBytes) return null;
  return { mimeType: match[1], data, dataUrl: image.dataUrl };
}

function makePrompt(question) {
  const focus = question?.trim()
    ? `\n\nThe user also asks you to focus on: ${question.trim()}`
    : "";
  return `Read the document page images carefully. Find every question or exercise that is visible and answer each one. Preserve the original question numbers and keep each answer directly below its question. Use information from the document when it provides the answer; when a question requires solving or reasoning, solve it and show the key steps. If the page is an instruction sheet or form without questions, explain its key information instead. If something is too blurry or unreadable, say exactly what you could not read. Do not invent text that is not visible. Format the response with clear headings and readable spacing.${focus}`;
}

async function readProviderError(response) {
  let body;
  try {
    body = await response.json();
  } catch (_error) {
    return `The provider returned HTTP ${response.status}.`;
  }
  const message = body?.error?.message || body?.message || body?.error || `HTTP ${response.status}`;
  return typeof message === "string" ? message.slice(0, 420) : `HTTP ${response.status}`;
}

async function callGroq(images, prompt) {
  const model = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
  const content = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful document reader and tutor. Ground your response in the supplied page images." },
        { role: "user", content },
      ],
      temperature: 0.2,
      max_completion_tokens: 4096,
    }),
  });
  if (!response.ok) throw new Error(`Groq: ${await readProviderError(response)}`);
  const result = await response.json();
  return { answer: result.choices?.[0]?.message?.content, model };
}

async function callSarvam(images, prompt) {
  const model = process.env.SARVAM_MODEL || "gemma4";
  const content = [{ type: "text", text: prompt }];
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  const response = await fetch("https://api.sarvam.ai/v2/chat/completions", {
    method: "POST",
    headers: {
      "api-subscription-key": process.env.SARVAM_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a careful document reader and tutor. Ground your response in the supplied page images." },
        { role: "user", content },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });
  if (!response.ok) throw new Error(`Sarvam: ${await readProviderError(response)}`);
  const result = await response.json();
  return { answer: result.choices?.[0]?.message?.content, model };
}

async function callGemini(images, prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const parts = [{ text: prompt }];
  for (const image of images) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  }
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "You are a careful document reader and tutor. Ground your response in the supplied page images." }] },
      contents: [{ role: "user", parts }],
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  if (!response.ok) throw new Error(`Gemini: ${await readProviderError(response)}`);
  const result = await response.json();
  const answer = result.candidates?.[0]?.content?.parts
    ?.filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text)
    .join("\n");
  return { answer, model };
}

app.post("/api/answer", checkRateLimit, async (req, res) => {
  const { provider, images, question } = req.body || {};
  if (!["gemini", "groq", "sarvam"].includes(provider)) {
    return res.status(400).json({ error: "Choose Gemini, Groq, or Sarvam." });
  }
  if (!Array.isArray(images) || images.length < 1 || images.length > maxImages) {
    return res.status(400).json({ error: `Add between 1 and ${maxImages} page images.` });
  }
  if (question !== undefined && (typeof question !== "string" || question.length > 1000)) {
    return res.status(400).json({ error: "The extra focus question must be 1,000 characters or fewer." });
  }
  const cleanImages = images.map(parseImage);
  if (cleanImages.some((image) => !image)) {
    return res.status(400).json({ error: "One or more images are invalid or larger than 4 MB. Please scan the page again." });
  }
  if (!isConfigured(provider)) {
    const keyNames = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", sarvam: "SARVAM_API_KEY" };
    return res.status(503).json({ error: `Add ${keyNames[provider]} in your .env file or Render environment settings to use this provider.` });
  }

  try {
    const prompt = makePrompt(question);
    const result = provider === "groq"
      ? await callGroq(cleanImages, prompt)
      : provider === "sarvam"
        ? await callSarvam(cleanImages, prompt)
        : await callGemini(cleanImages, prompt);
    if (typeof result.answer !== "string" || !result.answer.trim()) {
      throw new Error("The model returned an empty response. Try a clearer scan or another model.");
    }
    res.json({ answer: result.answer.trim(), provider, model: result.model });
  } catch (error) {
    const isProviderError = error instanceof Error && /^(Groq|Sarvam|Gemini):/.test(error.message);
    console.error("Document answer request failed:", error.message);
    res.status(isProviderError ? 502 : 500).json({
      error: error.message || "Unable to read this document right now. Please try again.",
    });
  }
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "The scans are too large. Try fewer pages or a clearer, smaller image." });
  }
  console.error("Request error:", error.message);
  res.status(400).json({ error: "The request could not be read. Please try again." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Pagewise is ready on port ${port}`);
});
