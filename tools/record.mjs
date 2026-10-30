import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (typeof WebSocket === "undefined" && !process.execArgv.includes("--experimental-websocket")) {
  const child = spawn(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  await main();
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const theme = option("theme", "light");
  const fps = Number(option("fps", 15));
  const seconds = Number(option("seconds", 8.4));
  const width = Number(option("width", 640));
  const colors = Number(option("colors", 192));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(option("out", join(root, "docs", "media", `gerbang-masuk-${theme}.gif`)));
  const page = join(root, "docs", "demo", theme === "light" ? "gerbang-masuk-light.html" : "gerbang-masuk.html");

  if (!["light", "dark"].includes(theme)) throw new Error(`--theme must be light or dark, got ${theme}`);
  if (![fps, seconds, width, colors].every(Number.isFinite) || fps <= 0 || seconds <= 0 || width < 100 || colors < 2) {
    throw new Error("--fps, --seconds, --width and --colors must be positive numbers");
  }
  if (!existsSync(page)) throw new Error(`missing ${page}; run npm run build:light first`);
  if (!ffmpeg()) throw new Error("ffmpeg is required to encode the GIF");

  const browser = findBrowser();
  if (!browser) throw new Error("No Chrome/Chromium found. Set CHROME_PATH to a browser binary.");

  const profile = mkdtempSync(join(tmpdir(), "gerbang-profile-"));
  const frames = mkdtempSync(join(tmpdir(), "gerbang-frames-"));
  let chromeError = "";
  const chrome = spawn(browser, [
    "--headless=new",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", (data) => { chromeError += data.toString(); });

  let socket;
  try {
    const port = await devtoolsPort(profile, () => chromeError);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    let sequence = 0;
    const pending = new Map();
    const problems = [];
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (data.id && pending.has(data.id)) {
        pending.get(data.id)(data);
        pending.delete(data.id);
        return;
      }
      if (data.method === "Runtime.exceptionThrown") {
        const detail = data.params.exceptionDetails;
        problems.push(`exception: ${detail.exception?.description ?? detail.text}`.slice(0, 600));
      } else if (data.method === "Runtime.consoleAPICalled" && (data.params.type === "error" || data.params.type === "warning")) {
        problems.push(`console.${data.params.type}: ${data.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`.slice(0, 600));
      }
    };
    await new Promise((done, fail) => {
      socket.onopen = done;
      socket.onerror = () => fail(new Error("WebSocket connection to Chrome failed"));
    });
    const send = (method, params = {}, patience = 30000) =>
      new Promise((done, fail) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          fail(new Error(`Chrome did not answer ${method} within ${Math.round(patience / 1000)} s`));
        }, patience);
        pending.set(id, (data) => {
          clearTimeout(timer);
          if (data.error) fail(new Error(`${method}: ${data.error.message}`));
          else done(data);
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression, patience = 30000) => {
      const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, patience);
      const detail = reply.result?.exceptionDetails;
      if (detail) throw new Error(detail.exception?.description ?? detail.text);
      return reply.result?.result?.value;
    };
    const waitFor = async (expression, patience = 20000) => {
      const limit = Date.now() + patience;
      while (Date.now() < limit) {
        try {
          if (await evaluate(expression, 5000)) return;
        } catch {}
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${expression}\n${problems.join("\n")}`);
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 1000, deviceScaleFactor: 1, mobile: false });
    const navigation = await send("Page.navigate", { url: `${pathToFileURL(page).href}#record` });
    if (navigation.error) throw new Error(`navigation failed: ${navigation.error.message}`);
    await waitFor(`document.readyState === "complete" && !!window.__gerbang`);
    await evaluate("document.fonts.ready.then(() => true)");
    await sleep(200);

    await evaluate(`(() => {
      const style = document.createElement("style");
      style.textContent = "*{animation:none!important;transition:none!important}";
      document.head.appendChild(style);
    })()`);
    await evaluate("window.__gerbang.cycle(0); window.__gerbang.stop(); window.__gerbang.draw(); window.scrollTo(0, 0);");

    const rect = await evaluate(`(() => {
      const el = document.querySelector(".iso-plate");
      if (!el) throw new Error("no .iso-plate");
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    })()`);
    const clip = { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4, scale: 1 };
    if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > 1000 || clip.y + clip.height > 1000) {
      throw new Error(`clip ${JSON.stringify(clip)} does not fit the 1000x1000 viewport`);
    }

    const total = Math.round(fps * seconds);
    for (let index = 0; index <= total; index++) {
      if (index > 0) await evaluate(`window.__gerbang.step(${1 / fps}); window.__gerbang.draw();`);
      const t = index / fps;
      await evaluate(`(() => {
        const el = document.querySelector('[data-part="screen-scan"]');
        if (el) el.style.transform = "translateY(" + ((((${t} / 2.4) % 1) * 27).toFixed(2)) + "px)";
      })()`);
      const shot = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
      writeFileSync(join(frames, `frame-${String(index).padStart(4, "0")}.png`), Buffer.from(shot.result.data, "base64"));
    }

    mkdirSync(dirname(out), { recursive: true });
    const filter = `scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
    const encoded = spawnSync("ffmpeg", [
      "-y",
      "-framerate", String(fps),
      "-start_number", "0",
      "-i", join(frames, "frame-%04d.png"),
      "-vf", filter,
      "-loop", "0",
      out,
    ], { encoding: "utf8" });
    if (encoded.status !== 0) throw new Error(`ffmpeg failed:\n${(encoded.stderr || "").slice(-3000)}`);
    const megabytes = (statSync(out).size / 1048576).toFixed(2);
    console.log(`wrote ${out} (${megabytes} MB, ${total + 1} frames at ${fps} fps)`);
    if (problems.length) console.log(problems.join("\n"));
  } finally {
    try { socket?.close(); } catch {}
    chrome.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
    rmSync(frames, { recursive: true, force: true });
  }
}

function ffmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/brave",
    "/opt/brave-origin-bin/brave",
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const cache = join(homedir(), ".cache", "ms-playwright");
  try {
    for (const dir of readdirSync(cache).sort().reverse()) {
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const candidate = join(cache, dir, sub);
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {}
  return null;
}

async function devtoolsPort(profile, errorText) {
  const file = join(profile, "DevToolsActivePort");
  const limit = Date.now() + 15000;
  while (Date.now() < limit) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, "utf8").split("\n");
      if (port && Number(port)) return Number(port);
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not open its DevTools port\n${errorText().slice(-2000)}`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}
