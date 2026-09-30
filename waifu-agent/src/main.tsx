import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";

// Forward ALL console output to waifu-agent.log
(function patchConsole() {
  const _log = console.log.bind(console);
  const _warn = console.warn.bind(console);
  const _err = console.error.bind(console);
  const fmtLine = (level: string, args: any[]) =>
    `[${level}] ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ")}`;
  const toFile = (level: string, args: any[]) => {
    try { invoke("frontend_log", { msg: fmtLine(level, args) }).catch(() => {}); } catch { /* ignore */ }
  };
  console.log = (...a: any[]) => { _log(...a); toFile("LOG", a); };
  console.warn = (...a: any[]) => { _warn(...a); toFile("WARN", a); };
  console.error = (...a: any[]) => { _err(...a); toFile("ERROR", a); };
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
