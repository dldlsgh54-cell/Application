import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputRoot = path.join(rootDir, "ShortsAutoOutput");
const profileDir = path.join(rootDir, ".chatgpt-profile");
const maxPrompts = 20;
const cdpUrl = process.env.EDGE_CDP_URL || "http://127.0.0.1:9222";
const edgePaths = [
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

let browser = null;
let browserContext = null;
let page = null;
let connectedByCdp = false;
let running = false;
let paused = false;
let progressMessage = "대기 중";
let currentLog = [];

function now() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

function log(message) {
  const line = `[${now()}] ${message}`;
  currentLog.unshift(line);
  console.log(line);
}

function setProgress(message) {
  progressMessage = message;
  log(message);
}

async function waitIfPaused() {
  while (running && paused) {
    await page.waitForTimeout(500);
  }
}

function sanitize(value) {
  return (value || "shorts_project").replace(/[\\/:*?"<>|]/g, "_").trim() || "shorts_project";
}

function isChatGptUrl(url) {
  return /https?:\/\/([^/]+\.)?chatgpt\.com\//i.test(url || "");
}

async function ensureBrowser() {
  if (browserContext) return browserContext;
  await fs.mkdir(outputRoot, { recursive: true });

  const cdpContext = await tryConnectExistingEdge();
  if (cdpContext) {
    browserContext = cdpContext;
    connectedByCdp = true;
    page = await pickWorkingPage(browserContext);
    log("기존 Edge 브라우저에 연결했습니다.");
    return browserContext;
  }

  connectedByCdp = false;
  browserContext = await launchEdgeContext();
  page = await pickWorkingPage(browserContext);
  log("자동화용 Edge 브라우저를 새로 열었습니다.");
  return browserContext;
}

async function tryConnectExistingEdge() {
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 1500 });
    return browser.contexts()[0] || null;
  } catch {
    return null;
  }
}

async function launchEdgeContext() {
  const launchOptions = {
    channel: "msedge",
    headless: false,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
    downloadsPath: outputRoot
  };

  try {
    return await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (edgeError) {
    for (const executablePath of edgePaths) {
      try {
        await fs.access(executablePath);
        return await chromium.launchPersistentContext(profileDir, {
          ...launchOptions,
          channel: undefined,
          executablePath
        });
      } catch {
        // Try next Edge path.
      }
    }
    throw edgeError;
  }
}

async function pickWorkingPage(context) {
  const pages = context.pages();
  const chatPage = [...pages].reverse().find((candidate) => isChatGptUrl(candidate.url()));
  const selected = chatPage || pages[pages.length - 1] || await context.newPage();
  selected.setDefaultTimeout(10000);
  return selected;
}

async function ensureChatGptPage({ navigateIfMissing = true } = {}) {
  await ensureBrowser();
  page = await pickWorkingPage(browserContext);
  if (isChatGptUrl(page.url())) {
    await page.bringToFront().catch(() => {});
    return { found: true, page };
  }

  if (!navigateIfMissing) {
    return { found: false, page };
  }

  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => {});
  return { found: false, page };
}

async function openChatGpt() {
  const result = await ensureChatGptPage({ navigateIfMissing: true });
  if (result.found) {
    log(`현재 ChatGPT 탭에 연결됨: ${page.url()}`);
  } else {
    log("ChatGPT를 열었습니다. 로그인 화면이면 먼저 로그인하세요.");
  }
}

async function getConnectionStatus() {
  const result = await ensureChatGptPage({ navigateIfMissing: false });
  const title = await page.title().catch(() => "");
  const url = page.url();
  return {
    connected: result.found,
    usingCdp: connectedByCdp,
    title,
    url,
    message: result.found
      ? "ChatGPT 탭에 연결되었습니다. 실행하면 이 탭에서 바로 시작합니다."
      : "Edge는 연결되었지만 ChatGPT 탭을 찾지 못했습니다. Edge에서 ChatGPT를 열어주세요."
  };
}

async function findPromptBox() {
  const selectors = [
    "#prompt-textarea",
    "[data-testid='composer-root'] [contenteditable='true']",
    "form [contenteditable='true']",
    "div[contenteditable='true'][id='prompt-textarea']",
    "textarea",
    "[contenteditable='true']",
    "div.ProseMirror",
    "[data-placeholder*='무엇이든 물어보세요']",
    "[data-placeholder*='Message']",
    "[data-placeholder*='무엇이든']",
    "[aria-label*='Message']",
    "[aria-label*='메시지']",
    "[aria-label*='프롬프트']"
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

async function fillPromptBox(box, prompt) {
  await box.click();
  try {
    await box.fill(prompt);
    return;
  } catch {
    // contenteditable editors sometimes reject fill(); keyboard insertion is the fallback.
  }
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.insertText(prompt);
}

async function clickSend() {
  const candidates = [
    "button[data-testid='send-button']",
    "button[data-testid='composer-submit-button']",
    "button[aria-label*='Send prompt']",
    "button[aria-label*='프롬프트 보내기']",
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
    "button[aria-label*='전송']",
    "button:has-text('Send')",
    "form button:not([disabled])"
  ];

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await waitIfPaused();
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
    await page.waitForTimeout(300);
  }

  throw new Error("전송 버튼이 활성화되지 않았습니다.");
}

async function submitPrompt(prompt) {
  const box = await findPromptBox();
  if (!box) throw new Error("ChatGPT 입력창을 찾지 못했습니다.");
  await fillPromptBox(box, prompt);
  await page.waitForTimeout(700);
  await clickSend();
  await page.waitForTimeout(3000);
}

async function waitUntilGenerationSettles() {
  const start = Date.now();
  let stableChecks = 0;
  while (Date.now() - start < 240000) {
    await waitIfPaused();
    const stopVisible = await page.locator([
      "button:has-text('Stop')",
      "button:has-text('중지')",
      "button:has-text('중단')",
      "button[aria-label*='Stop']",
      "button[aria-label*='중지']",
      "button[aria-label*='중단']"
    ].join(", ")).count().catch(() => 0);
    const generatingText = await page.locator("text=/generating|creating|drawing|이미지 생성|생성 중|만드는 중/i").count().catch(() => 0);
    if (!stopVisible && !generatingText) {
      stableChecks += 1;
      if (Date.now() - start > 15000 && stableChecks >= 3) return true;
    } else {
      stableChecks = 0;
    }
    await page.waitForTimeout(5000);
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
  paused = false;
  progressMessage = "작업 시작";
  currentLog = [];

  const safeProject = sanitize(projectName);
  const projectDir = path.join(outputRoot, safeProject);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, "prompts.txt"), prompts.join("\n\n"), "utf8");

  try {
    await openChatGpt();
    if (!isChatGptUrl(page.url())) {
      throw new Error("ChatGPT 탭에 연결되지 않았습니다.");
    }

    if (batchMode) {
      const combined = buildBatchPrompt(prompts);
      setProgress(`${prompts.length}개 이미지를 한 번에 요청합니다.`);
      await submitPrompt(combined);
      await waitUntilGenerationSettles();
      setProgress("통합 생성 완료. 이미지 다운로드는 진행하지 않습니다.");
    } else {
      for (let i = 0; i < prompts.length; i++) {
        await waitIfPaused();
        setProgress(`프롬프트 ${i + 1}/${prompts.length} 입력 및 전송 중`);
        await submitPrompt(prompts[i]);
        setProgress(`프롬프트 ${i + 1}/${prompts.length} 이미지 생성 대기 중`);
        const settled = await waitUntilGenerationSettles();
        if (!settled) log(`프롬프트 ${i + 1} 대기 시간 초과`);
        setProgress(`프롬프트 ${i + 1}/${prompts.length} 완료. 다운로드는 진행하지 않습니다.`);
        await page.waitForTimeout(2000);
      }
    }

    setProgress(`작업 완료. 저장 폴더: ${projectDir}`);
    await fs.writeFile(path.join(projectDir, "log.txt"), currentLog.slice().reverse().join("\n"), "utf8");
  } finally {
    running = false;
    paused = false;
    progressMessage = "대기 중";
  }
}

function buildBatchPrompt(prompts) {
  const count = prompts.length;
  return [
    `아래 ${count}개의 이미지 프롬프트를 각각 독립적인 이미지로 생성해줘.`,
    `반드시 한 장에 ${count}컷을 합치지 말고, 01부터 ${String(count).padStart(2, "0")}까지 별도의 이미지 ${count}장으로 만들어줘.`,
    "모든 이미지는 쇼츠용 9:16 세로 비율로 만들어줘.",
    "",
    ...prompts.map((prompt, index) => `Image ${String(index + 1).padStart(2, "0")}:\n${prompt}`)
  ].join("\n\n");
}

app.post("/api/open-chatgpt", async (_req, res) => {
  try {
    await openChatGpt();
    res.json({ ok: true, url: page.url(), usingCdp: connectedByCdp });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/check-chatgpt", async (_req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/run", async (req, res) => {
  const prompts = (req.body.prompts || []).map((value) => String(value || "").trim()).filter(Boolean).slice(0, maxPrompts);
  if (!prompts.length) return res.status(400).json({ ok: false, error: "프롬프트가 없습니다." });
  runAutomation({
    projectName: req.body.projectName,
    prompts,
    batchMode: Boolean(req.body.batchMode)
  }).catch((error) => log(`오류: ${error.message}`));
  res.json({ ok: true });
});

app.post("/api/pause", (_req, res) => {
  if (!running) return res.json({ ok: true, running, paused });
  paused = true;
  progressMessage = "일시 중지";
  log("일시 중지했습니다. 재시작을 누르면 다음 단계부터 계속 진행합니다.");
  res.json({ ok: true, running, paused });
});

app.post("/api/resume", (_req, res) => {
  if (!running) return res.json({ ok: true, running, paused });
  paused = false;
  progressMessage = "재시작";
  log("재시작했습니다.");
  res.json({ ok: true, running, paused });
});

app.get("/api/status", (_req, res) => {
  res.json({ running, paused, progressMessage, log: currentLog });
});

app.get("/api/output-path", (_req, res) => {
  res.json({ outputRoot });
});

const port = Number(process.env.PORT || 3737);
app.listen(port, () => {
  console.log(`Shorts Auto PC is running: http://localhost:${port}`);
});
