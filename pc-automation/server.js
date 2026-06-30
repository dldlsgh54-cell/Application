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
let progressMessage = "Idle";
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
  while (running && paused) await page.waitForTimeout(500);
}

function sanitize(value) {
  return (value || "shorts_project").replace(/[\\/:*?"<>|]/g, "_").trim() || "shorts_project";
}

function isChatGptUrl(url) {
  return String(url || "").toLowerCase().includes("chatgpt.com");
}

function resetBrowserRefs() {
  browser = null;
  browserContext = null;
  page = null;
  connectedByCdp = false;
}

async function ensureBrowser() {
  if (browserContext) {
    try {
      page = await pickWorkingPage(browserContext);
      return browserContext;
    } catch {
      resetBrowserRefs();
    }
  }

  await fs.mkdir(outputRoot, { recursive: true });
  const cdpContext = await tryConnectExistingEdge();
  if (cdpContext) {
    browserContext = cdpContext;
    connectedByCdp = true;
    page = await pickWorkingPage(browserContext);
    log("Connected to existing Edge browser.");
    return browserContext;
  }

  connectedByCdp = false;
  browserContext = await launchEdgeContext();
  page = await pickWorkingPage(browserContext);
  log("Opened automation Edge browser.");
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
  const pages = context.pages().filter((candidate) => !candidate.isClosed());
  const chatPage = [...pages].reverse().find((candidate) => isChatGptUrl(candidate.url()));
  const selected = chatPage || pages[pages.length - 1] || await context.newPage();
  selected.setDefaultTimeout(10000);
  return selected;
}

async function ensureChatGptPage() {
  await ensureBrowser();
  page = await pickWorkingPage(browserContext);
  if (isChatGptUrl(page.url())) {
    await page.bringToFront().catch(() => {});
    return { found: true, page };
  }
  return { found: false, page };
}

async function getConnectionStatus() {
  const result = await ensureChatGptPage();
  const title = page ? await page.title().catch(() => "") : "";
  const url = page ? page.url() : "";
  return {
    connected: result.found,
    usingCdp: connectedByCdp,
    title,
    url,
    message: result.found
      ? "ChatGPT tab connected."
      : "ChatGPT tab was not found. Open chatgpt.com in Edge first."
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
    "[placeholder*='무엇이든']",
    "[data-placeholder*='무엇이든']",
    "[data-placeholder*='Message']",
    "[aria-label*='Message']",
    "[aria-label*='메시지']",
    "[aria-label*='프롬프트']"
  ];

  for (const selector of selectors) {
    const matches = page.locator(selector);
    const count = await matches.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) {
      const locator = matches.nth(i);
      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;
      const box = await locator.boundingBox().catch(() => null);
      const viewport = page.viewportSize() || { height: 900 };
      if (box && box.y >= viewport.height * 0.5) return locator;
    }
  }

  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count()) {
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return locator;
    }
  }
  return null;
}

async function getPromptBoxText(box) {
  if (!box) return "";
  return await box.evaluate((element) => {
    if ("value" in element) return element.value || "";
    return element.innerText || element.textContent || "";
  }).catch(() => "");
}

async function typePromptText(prompt) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(prompt);
}

async function clickPromptCoordinateFallback() {
  return await page.evaluate(() => {
    const bottom = window.innerHeight * 0.5;
    const candidates = [...document.querySelectorAll("textarea, input, [contenteditable='true'], div, p")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const text = `${element.getAttribute("placeholder") || ""} ${element.getAttribute("data-placeholder") || ""} ${element.getAttribute("aria-label") || ""} ${element.textContent || ""}`;
        return { element, rect, text };
      })
      .filter(({ rect, text }) => rect.width > 80 && rect.height > 20 && rect.y >= bottom && /무엇이든|물어보세요|message|prompt/i.test(text))
      .sort((a, b) => (b.rect.y + b.rect.height) - (a.rect.y + a.rect.height));
    const target = candidates[0];
    if (!target) return false;
    target.element.click();
    return true;
  }).catch(() => false);
}

async function fillPromptBox(box, prompt) {
  await box.click();
  await typePromptText(prompt);
  await page.waitForTimeout(500);
  let text = (await getPromptBoxText(box)).trim();
  if (!text) {
    await box.evaluate((element, value) => {
      if ("value" in element) element.value = value;
      else element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }, prompt);
    await page.waitForTimeout(500);
    text = (await getPromptBoxText(box)).trim();
  }
  if (!text) throw new Error("Prompt was not inserted into the input box.");
}

async function clickSend() {
  const candidates = [
    "button[data-testid='send-button']",
    "button[data-testid='composer-submit-button']",
    "button[aria-label*='Send prompt']",
    "button[aria-label*='프롬프트 보내기']",
    "button[aria-label*='메시지 보내기']",
    "button[aria-label*='보내기']",
    "button[aria-label*='Send']",
    "button[aria-label*='send']",
    "button[aria-label*='전송']",
    "button:has-text('Send')"
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
    const fallbackClicked = await clickSendCoordinateFallback();
    if (fallbackClicked) return true;
    await page.waitForTimeout(300);
  }
  throw new Error("Send button was not active.");
}

async function clickSendCoordinateFallback() {
  return await page.evaluate(() => {
    const blocked = /attach|file|upload|voice|mic|microphone|dictate|audio|파일|첨부|업로드|음성|마이크/i;
    const candidates = [...document.querySelectorAll("button")]
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""} ${button.getAttribute("data-testid") || ""}`;
        return { button, rect, label };
      })
      .filter(({ button, rect, label }) =>
        !button.disabled &&
        rect.width > 18 &&
        rect.height > 18 &&
        rect.y >= window.innerHeight * 0.5 &&
        rect.x >= window.innerWidth * 0.45 &&
        !blocked.test(label)
      )
      .sort((a, b) => (b.rect.x + b.rect.y) - (a.rect.x + a.rect.y));
    const target = candidates[0]?.button;
    if (!target) return false;
    target.click();
    return true;
  }).catch(() => false);
}

async function countUserMessages() {
  return await page.locator("[data-message-author-role='user']").count().catch(() => 0);
}

async function waitForPromptSent(box, beforeUserMessages) {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    const afterUserMessages = await countUserMessages();
    if (afterUserMessages > beforeUserMessages) return true;
    await page.waitForTimeout(400);
  }
  const text = (await getPromptBoxText(box)).trim();
  if (!text) {
    throw new Error("Input became empty, but no new user message appeared in ChatGPT.");
  }
  return false;
}

async function submitPrompt(prompt) {
  const box = await findPromptBox();
  const beforeUserMessages = await countUserMessages();
  if (box) {
    await fillPromptBox(box, prompt);
  } else {
    const clicked = await clickPromptCoordinateFallback();
    if (!clicked) throw new Error("ChatGPT input box was not found.");
    await typePromptText(prompt);
  }
  await page.waitForTimeout(700);
  await clickSend();
  const sent = await waitForPromptSent(box, beforeUserMessages);
  if (!sent) throw new Error("No new user message appeared in ChatGPT.");
}

async function countStopButtons() {
  return await page.locator([
    "button:has-text('Stop')",
    "button:has-text('중지')",
    "button:has-text('중단')",
    "button[aria-label*='Stop']",
    "button[aria-label*='중지']",
    "button[aria-label*='중단']"
  ].join(", ")).count().catch(() => 0);
}

async function waitUntilGenerationSettles(index, total) {
  const start = Date.now();
  let stableChecks = 0;
  while (Date.now() - start < 240000) {
    await waitIfPaused();
    const elapsed = Math.floor((Date.now() - start) / 1000);
    progressMessage = `Prompt ${index}/${total} waiting for image generation (${elapsed}s)`;
    const stopVisible = await countStopButtons();
    if (!stopVisible) {
      stableChecks += 1;
      if (elapsed > 20 && stableChecks >= 3) return true;
      if (elapsed >= 90) {
        log(`Prompt ${index} waited 90s. Moving to next prompt.`);
        return true;
      }
    } else {
      stableChecks = 0;
    }
    await page.waitForTimeout(5000);
  }
  return false;
}

async function runAutomation({ projectName, prompts }) {
  if (running) throw new Error("Already running.");
  running = true;
  paused = false;
  progressMessage = "Starting";
  currentLog = [];

  const safeProject = sanitize(projectName);
  const projectDir = path.join(outputRoot, safeProject);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, "prompts.txt"), prompts.join("\n\n"), "utf8");

  try {
    const result = await ensureChatGptPage();
    if (!result.found) throw new Error("ChatGPT tab is not connected.");

    for (let i = 0; i < prompts.length; i++) {
      await waitIfPaused();
      setProgress(`Prompt ${i + 1}/${prompts.length} typing and sending`);
      await submitPrompt(prompts[i]);
      setProgress(`Prompt ${i + 1}/${prompts.length} waiting for image generation`);
      const settled = await waitUntilGenerationSettles(i + 1, prompts.length);
      if (!settled) log(`Prompt ${i + 1} timed out.`);
      setProgress(`Prompt ${i + 1}/${prompts.length} done. No download.`);
      await page.waitForTimeout(2000);
    }

    setProgress(`Done. Output folder: ${projectDir}`);
    await fs.writeFile(path.join(projectDir, "log.txt"), currentLog.slice().reverse().join("\n"), "utf8");
  } finally {
    running = false;
    paused = false;
    progressMessage = "Idle";
  }
}

app.get("/api/check-chatgpt", async (_req, res) => {
  try {
    const status = await getConnectionStatus();
    res.json({ ok: true, ...status });
  } catch (error) {
    resetBrowserRefs();
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/run", async (req, res) => {
  const prompts = (req.body.prompts || []).map((value) => String(value || "").trim()).filter(Boolean).slice(0, maxPrompts);
  if (!prompts.length) return res.status(400).json({ ok: false, error: "No prompts." });
  runAutomation({ projectName: req.body.projectName, prompts }).catch((error) => log(`ERROR: ${error.message}`));
  res.json({ ok: true });
});

app.post("/api/pause", (_req, res) => {
  if (!running) return res.json({ ok: true, running, paused });
  paused = true;
  progressMessage = "Paused";
  log("Paused.");
  res.json({ ok: true, running, paused });
});

app.post("/api/resume", (_req, res) => {
  if (!running) return res.json({ ok: true, running, paused });
  paused = false;
  progressMessage = "Resumed";
  log("Resumed.");
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
