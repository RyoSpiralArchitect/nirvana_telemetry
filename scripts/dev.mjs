import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const viteEntry = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);
const cwd = fileURLToPath(new URL("..", import.meta.url));

const api = spawn(process.execPath, ["server/index.mjs", "--api-only"], {
  cwd,
  env: {
    ...process.env,
    PORT: "8787",
    NIRVANA_ALLOWED_ORIGINS:
      process.env.NIRVANA_ALLOWED_ORIGINS || "http://127.0.0.1:5173",
  },
  stdio: "inherit",
});
const ui = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1"], {
  cwd,
  stdio: "inherit",
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill("SIGTERM");
  ui.kill("SIGTERM");
  setTimeout(() => process.exit(code), 120).unref();
}

api.on("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
ui.on("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
