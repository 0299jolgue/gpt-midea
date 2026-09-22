import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const IMAGE_DIR = path.join(DATA_DIR, "images");
const INDEX_FILE = path.join(DATA_DIR, "index.json");
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || "";
const MCP_TOKEN = process.env.MCP_TOKEN || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

await fs.mkdir(IMAGE_DIR, { recursive: true });

async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function writeIndex(items) {
  const tmp = `${INDEX_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(items, null, 2), "utf8");
  await fs.rename(tmp, INDEX_FILE);
}

function normalizeId(value) {
  const match = String(value || "").trim().match(/^(?:0*)(\\d{1,})$/);
  if (!match) return null;
  return String(Number(match[1])).padStart(3, "0");
}

function extensionForMime(mimeType) {
  const map = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif"
  };
  return map[mimeType] || null;
}

function requireUploadToken(req, res, next) {
  if (!UPLOAD_TOKEN) {
    return res.status(503).json({
      error: "Uploads desativados: define UPLOAD_TOKEN no ambiente."
    });
  }

  const token = req.get("x-upload-token") || req.body?.token || "";
  if (token !== UPLOAD_TOKEN) {
    return res.status(401).json({ error: "Token de upload inválido." });
  }
  next();
}

function checkMcpToken(req) {
  if (!MCP_TOKEN) return true;
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length) === MCP_TOKEN;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    cb(null, Boolean(extensionForMime(file.mimetype)));
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gpt-midea-image-vault" });
});

app.get("/api/images", async (_req, res) => {
  const items = await readIndex();
  res.json({
    count: items.length,
    items
  });
});

app.post("/api/upload", requireUploadToken, upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Envia um ficheiro de imagem no campo 'image'." });
  }

  const items = await readIndex();
  const maxId = items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  const id = String(maxId + 1).padStart(3, "0");
  const extension = extensionForMime(req.file.mimetype);

  if (!extension) {
    return res.status(415).json({ error: "Formato de imagem não suportado." });
  }

  const filename = `${id}.${extension}`;
  const target = path.join(IMAGE_DIR, filename);

  await fs.writeFile(target, req.file.buffer);

  const item = {
    id,
    filename,
    mimeType: req.file.mimetype,
    size: req.file.size,
    createdAt: new Date().toISOString(),
    imageUrl: `/image/${id}`,
    viewerUrl: `/i/${id}`
  };

  items.push(item);
  await writeIndex(items);

  res.status(201).json(item);
});

app.delete("/api/images/:id", requireUploadToken, async (req, res) => {
  const id = normalizeId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido." });

  const items = await readIndex();
  const item = items.find((entry) => entry.id === id);

  if (!item) return res.status(404).json({ error: "Imagem não encontrada." });

  await fs.rm(path.join(IMAGE_DIR, item.filename), { force: true });
  await writeIndex(items.filter((entry) => entry.id !== id));

  res.json({ ok: true, id });
});

async function findImage(id) {
  const normalizedId = normalizeId(id);
  if (!normalizedId) return null;

  const items = await readIndex();
  const item = items.find((entry) => entry.id === normalizedId);
  if (!item) return null;

  const filePath = path.join(IMAGE_DIR, item.filename);
  if (!existsSync(filePath)) return null;

  return { item, filePath };
}

app.get("/image/:id", async (req, res) => {
  const result = await findImage(req.params.id);
  if (!result) return res.status(404).send("Imagem não encontrada.");

  res.type(result.item.mimeType);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(result.filePath);
});

app.get("/i/:id", async (req, res) => {
  const result = await findImage(req.params.id);
  if (!result) return res.status(404).send("Imagem não encontrada.");

  const title = `Imagem ${result.item.id}`;
  const imageUrl = `/image/${result.item.id}`;

  res.type("html").send(`<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b0f14; color:#e9eef5; }
  main { width:min(94vw,1200px); padding:24px; box-sizing:border-box; }
  img { display:block; width:100%; max-height:78vh; object-fit:contain; border-radius:16px; background:#111821; }
  .meta { margin-top:12px; opacity:.75; font-size:14px; }
  a { color:inherit; }
</style>
</head>
<body>
<main>
<img src="${imageUrl}" alt="${title}">
<div class="meta"><strong>${title}</strong> · <a href="/api/images">API</a> · <a href="/image/${result.item.id}">imagem direta</a></div>
</main>
</body>
</html>`);
});

app.get("/", async (_req, res) => {
  const items = await readIndex();

  res.type("html").send(`<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GPT Midea · Image Vault</title>
<style>
  :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:#080b10; color:#ecf2f8; }
  main { width:min(1180px,94vw); margin:0 auto; padding:48px 0 70px; }
  h1 { margin:0 0 8px; font-size:clamp(32px,6vw,58px); letter-spacing:-.04em; }
  .muted { opacity:.65; }
  .panel { margin-top:28px; padding:20px; border:1px solid #222b36; border-radius:18px; background:#0e141b; }
  form { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  input,button { border:1px solid #2b3744; border-radius:10px; background:#101821; color:inherit; padding:11px 13px; }
  input[type=file] { flex:1 1 220px; }
  input[type=password] { flex:1 1 220px; }
  button { cursor:pointer; font-weight:700; }
  button:hover { background:#17212c; }
  .status { margin-top:12px; min-height:20px; font-size:14px; }
  .grid { margin-top:28px; display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:14px; }
  .card { overflow:hidden; border:1px solid #222b36; border-radius:16px; background:#0e141b; }
  .card img { width:100%; aspect-ratio:1; object-fit:cover; display:block; background:#131b24; }
  .card .body { padding:12px; display:flex; justify-content:space-between; gap:10px; align-items:center; }
  .empty { padding:36px; text-align:center; opacity:.6; }
  a { color:inherit; text-decoration:none; }
</style>
</head>
<body>
<main>
  <h1>Image Vault</h1>
  <div class="muted">GPT Midea · imagens externas para consumo por API/MCP</div>

  <section class="panel">
    <form id="upload-form">
      <input id="file" type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" required>
      <input id="token" type="password" placeholder="UPLOAD_TOKEN">
      <button type="submit">Enviar imagem</button>
    </form>
    <div id="status" class="status"></div>
  </section>

  <section class="grid" id="grid">
    ${items.length
      ? items.slice().reverse().map((item) => `<article class="card">
          <a href="/i/${item.id}" target="_blank" rel="noreferrer">
            <img src="/image/${item.id}" alt="Imagem ${item.id}" loading="lazy">
          </a>
          <div class="body">
            <strong>${item.id}</strong>
            <a href="/image/${item.id}" target="_blank" rel="noreferrer">abrir ↗</a>
          </div>
        </article>`).join("")
      : '<div class="empty">Ainda não há imagens.</div>'}
  </section>
</main>
<script>
const form = document.querySelector("#upload-form");
const status = document.querySelector("#status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  status.textContent = "A enviar…";

  const fileInput = document.querySelector("#file");
  const token = document.querySelector("#token").value;
  const body = new FormData();
  body.append("image", fileInput.files[0]);

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: { "x-upload-token": token },
      body
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Falha no upload.");

    status.textContent = `Guardada como ${data.id}.`;
    location.reload();
  } catch (error) {
    status.textContent = error.message;
  }
});
</script>
</body>
</html>`);
});

function createMcpServer() {
  const server = new McpServer(
    {
      name: "gpt-midea-image-vault",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.registerTool(
    "list_images",
    {
      title: "List images",
      description: "Lista as imagens disponíveis no Image Vault, com IDs estáveis como 001, 002, 003.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional()
      })
    },
    async ({ limit = 50 }) => {
      const items = await readIndex();
      const selected = items.slice(-limit).reverse().map((item) => ({
        id: item.id,
        filename: item.filename,
        mimeType: item.mimeType,
        size: item.size,
        createdAt: item.createdAt,
        imageUrl: PUBLIC_BASE_URL ? new URL(item.imageUrl, PUBLIC_BASE_URL).toString() : item.imageUrl,
        viewerUrl: PUBLIC_BASE_URL ? new URL(item.viewerUrl, PUBLIC_BASE_URL).toString() : item.viewerUrl
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: selected.length, items: selected }, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    "get_image",
    {
      title: "Get image",
      description: "Lê uma imagem pelo seu ID e devolve os próprios pixels ao cliente MCP. Usa IDs como 001 ou 002.",
      inputSchema: z.object({
        id: z.string().min(1)
      })
    },
    async ({ id }) => {
      const result = await findImage(id);

      if (!result) {
        return {
          isError: true,
          content: [{ type: "text", text: `Imagem ${id} não encontrada.` }]
        };
      }

      const data = (await fs.readFile(result.filePath)).toString("base64");

      return {
        content: [
          {
            type: "text",
            text: `Imagem ${result.item.id} · ${result.item.filename} · ${result.item.mimeType}`
          },
          {
            type: "image",
            data,
            mimeType: result.item.mimeType
          }
        ]
      };
    }
  );

  server.registerTool(
    "get_image_url",
    {
      title: "Get image URL",
      description: "Obtém o URL direto e o URL da página de uma imagem.",
      inputSchema: z.object({
        id: z.string().min(1)
      })
    },
    async ({ id }) => {
      const result = await findImage(id);

      if (!result) {
        return {
          isError: true,
          content: [{ type: "text", text: `Imagem ${id} não encontrada.` }]
        };
      }

      const imageUrl = PUBLIC_BASE_URL
        ? new URL(`/image/${result.item.id}`, PUBLIC_BASE_URL).toString()
        : `/image/${result.item.id}`;
      const viewerUrl = PUBLIC_BASE_URL
        ? new URL(`/i/${result.item.id}`, PUBLIC_BASE_URL).toString()
        : `/i/${result.item.id}`;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: result.item.id,
                imageUrl,
                viewerUrl,
                mimeType: result.item.mimeType
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  return server;
}

const mcpHandler = createMcpHandler(createMcpServer);

app.all("/mcp", async (req, res, next) => {
  try {
    if (!checkMcpToken(req)) {
      return res.status(401).json({ error: "MCP token inválido ou ausente." });
    }

    const request = new Request(`http://${req.headers.host || "localhost"}${req.originalUrl}`, {
      method: req.method,
      headers: Object.fromEntries(
        Object.entries(req.headers).filter(([, value]) => typeof value === "string")
      ),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body ?? {})
    });

    const response = await mcpHandler.fetch(request);
    res.status(response.status);

    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (!response.body) return res.end();

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "A imagem excede o limite de 15 MB." });
  }
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  if (error?.message?.includes("Unexpected end of JSON input")) {
    return res.status(400).json({ error: "Pedido MCP inválido." });
  }
  res.status(500).json({ error: "Erro interno." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Image Vault a correr em http://0.0.0.0:${PORT}`);
  console.log(`MCP: http://0.0.0.0:${PORT}/mcp`);
});
