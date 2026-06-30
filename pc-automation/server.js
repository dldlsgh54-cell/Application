import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputRoot = path.join(rootDir, "ShortsAutoOutput");
const profileDir = path.join(rootDir, ".chatgpt-profile");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

let browserContext = null;
let page = null;
let running = false;
let currentLog = [];

function now() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

function log(message) {
  const line = `[${now()}] ${message}`;
  currentLog.unshift(line);
  console.log(line);
}

function sanitize(value) {
  return (value || "shorts_project").replace(/[\\/:*?"<>|]/g, "_").trim() || "shorts_project";
}

async function ensureBrowser() {
  if (browserContext) return browserContext;
  await fs.mkdir(outputRoot, { recursive: true });
  browserContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    downloadsPath: outputRoot
  });
  page = browserContext.pages()[0] || await browserContext.newPage();
  page.setDefaultTimeout(10000);
  return browserContext;
}

async function openChatGpt() {
  await ensureBrowser();
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  log("ChatGPT 열기 완료. 로그인 화면이면 먼저 로그인하세요.");
}

async function findPromptBox() {
  const selectors = [
    "textarea",
    "[contenteditable='true']",
    "div.ProseMirror",
    "[data-placeholder*='Message']",
    "[aria-label*='Message']",
    "[aria-label*='메시지']"
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count()) {
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return locator;
    }
  }
  return null;
}

async function clickSend() {
  const candidates = [
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
    "button[aria-label*='전송']",
    "button:has-text('Send')",
    "button[data-testid='send-button']"
  ];
  for (const selector of candidates) {
    const button = page.locator(selector).last();
    if (await button.count()) {
      const enabled = await button.isEnabled().catch(() => false);
      const visible = await button.isVisible().catch(() => false);
      if (enabled && visible) {
        await button.click();
        return true;
      }
    }
  }
  await page.keyboard.press("Enter");
  return true;
}

async function submitPrompt(prompt) {
  const box = await findPromptBox();
  if (!box) throw new Error("ChatGPT 입력창을 찾지 못했습니다.");
  await box.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(prompt, { delay: 1 });
  await page.waitForTimeout(500);
  await clickSend();
}

async function waitUntilGenerationSettles() {
  const start = Date.now();
  while (Date.now() - start < 240000) {
    const stopVisible = await page.locator("button:has-text('Stop'), button[aria-label*='Stop'], button[aria-label*='중지']").count().catch(() => 0);
    const generatingText = await page.locator("text=/generating|creating|생성 중|이미지 생성/i").count().catch(() => 0);
    if (!stopVisible && !generatingText) {
      await page.waitForTimeout(5000);
      return true;
    }
    await page.waitForTimeout(3000);
  }
  return false;
}

async function tryDownloadLatestImages(projectDir, index) {
  const downloadButtons = page.locator("a[download], button[aria-label*='Download'], button[aria-label*='다운로드']");
  const count = await downloadButtons.count().catch(() => 0);
  if (!count) return false;

  let saved = false;
  for (let i = Math.max(0, count - 3); i < count; i++) {
    const target = downloadButtons.nth(i);
    const visible = await target.isVisible().catch(() => false);
    if (!visible) continue;
    try {
      const downloadPromise = page.waitForEvent("download", { timeout: 7000 });
      await target.click();
      const download = await downloadPromise;
      const fileName = `${String(index + 1).padStart(2, "0")}-${Date.now()}-${download.suggestedFilename() || "image.png"}`;
      await download.saveAs(path.join(projectDir, fileName));
      saved = true;
    } catch {
      // Some ChatGPT buttons open menus instead of direct downloads.
    }
  }
  return saved;
}

async function runAutomation({ projectName, prompts, batchMode }) {
  if (running) throw new Error("이미 실행 중입니다.");
  running = true;
  currentLog = [];

  const safeProject = sanitize(projectName);
  const projectDir = path.join(outputRoot, safeProject);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, "prompts.txt"), prompts.join("\n\n"), "utf8");

  try {
    await openChatGpt();
    if (batchMode) {
      const combined = buildBatchPrompt(prompts);
      log("6장 한 번에 생성용 통합 프롬프트 전송");
      await submitPrompt(combined);
      await waitUntilGenerationSettles();
      await tryDownloadLatestImages(projectDir, 0);
      log("통합 생성 완료. 다운로드가 안 됐다면 브라우저에서 직접 저장하세요.");
    } else {
      for (let i = 0; i < prompts.length; i++) {
        log(`프롬프트 ${i + 1}/${prompts.length} 전송`);
        await submitPrompt(prompts[i]);
        const settled = await waitUntilGenerationSettles();
        if (!settled) log(`프롬프트 ${i + 1} 대기 시간 초과`);
        const downloaded = await tryDownloadLatestImages(projectDir, i);
        log(downloaded ? `프롬프트 ${i + 1} 이미지 다운로드 시도 완료` : `프롬프트 ${i + 1} 자동 다운로드 버튼 미감지`);
        await page.waitForTimeout(2000);
      }
    }
    log(`작업 완료. 저장 폴더: ${projectDir}`);
    await fs.writeFile(path.join(projectDir, "log.txt"), currentLog.slice().reverse().join("\n"), "utf8");
  } finally {
    running = false;
  }
}

function buildBatchPrompt(prompts) {
  return [
    "아래 6개의 이미지 프롬프트를 각각 독립된 이미지로 생성해줘.",
    "반드시 한 장에 6컷을 합치지 말고, 01부터 06까지 별도의 이미지 6장으로 만들어줘.",
    "모든 이미지는 쇼츠용 9:16 세로 비율로 만들어줘.",
    "",
    ...prompts.map((prompt, index) => `Image ${String(index + 1).padStart(2, "0")}:\n${prompt}`)
  ].join("\n\n");
}

app.post("/api/open-chatgpt", async (_req, res) => {
  try {
    await openChatGpt();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/run", async (req, res) => {
  const prompts = (req.body.prompts || []).map((value) => String(value || "").trim()).filter(Boolean).slice(0, 6);
  if (!prompts.length) return res.status(400).json({ ok: false, error: "프롬프트가 없습니다." });
  runAutomation({
    projectName: req.body.projectName,
    prompts,
    batchMode: Boolean(req.body.batchMode)
  }).catch((error) => log(`오류: ${error.message}`));
  res.json({ ok: true });
});

app.get("/api/status", (_req, res) => {
  res.json({ running, log: currentLog });
});

app.get("/api/output-path", (_req, res) => {
  res.json({ outputRoot });
});

const port = Number(process.env.PORT || 3737);
app.listen(port, () => {
  console.log(`Shorts Auto PC is running: http://localhost:${port}`);
});
