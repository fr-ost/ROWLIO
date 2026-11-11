// Styles for the in-page overlay (shadow DOM). Kept as a string so the content script is
// a single self-contained file. Colours come from brand.config.json.
import { brand } from '@/config/brand';

const accent = brand.colors.brand;
const accentDark = brand.colors.brandDark;

export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.boxes { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.box { position: absolute; top: 0; left: 0; pointer-events: none; border-radius: 3px; }
.box-hover { outline: 2px solid #2563eb; background: rgba(37, 99, 235, 0.12); }
.box-record { outline: 2px solid ${accent}; background: rgba(13, 148, 103, 0.10); }
.box-field { outline: 2px dashed #d97706; background: rgba(217, 119, 6, 0.14); }
.box-match { outline: 2px solid #7c3aed; background: rgba(124, 58, 237, 0.12); }
.box-flash { outline: 3px solid ${accent}; background: rgba(13, 148, 103, 0.18); animation: flash 0.5s ease-in-out 3; }
@keyframes flash { 50% { background: rgba(13, 148, 103, 0.04); } }
@media (prefers-reduced-motion: reduce) { .box-flash { animation: none; } }

.ui {
  position: fixed; inset: 0; pointer-events: none;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Bengali", sans-serif;
  color: #18181b;
  --bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --soft: #f4f4f5; --accent: ${accent}; --accent-dark: ${accentDark};
}
@media (prefers-color-scheme: dark) {
  .ui { --bg: #18181b; --fg: #f4f4f5; --muted: #a1a1aa; --line: #3f3f46; --soft: #27272a; }
}

.panel {
  position: fixed; right: 16px; bottom: 16px; width: 372px; max-width: calc(100vw - 32px); max-height: min(76vh, 640px);
  display: flex; flex-direction: column; pointer-events: auto;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.08);
  animation: rowlio-pop 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
  overflow: hidden;
}
.panel::before {
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, #10b981, #0ea5a4, #0ea5e9);
}
@keyframes rowlio-pop { from { opacity: 0; transform: translateY(14px) scale(0.97); } }
@keyframes rowlio-drop { from { opacity: 0; transform: translate(-50%, -16px); } }
.field { animation: rowlio-pop 0.3s cubic-bezier(0.16, 1, 0.3, 1) both; }
.box-record, .box-field, .box-match { transition: background 0.2s ease; }
@media (prefers-reduced-motion: reduce) { .panel, .field, .hud { animation: none !important; } }
.panel-head {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line);
  cursor: move; user-select: none;
}
.logo { width: 18px; height: 18px; border-radius: 5px; background: linear-gradient(135deg, #10b981, #0ea5e9); flex: none; position: relative; }
.logo::before, .logo::after { content: ""; position: absolute; left: 4px; height: 2px; background: #fff; border-radius: 1px; }
.logo::before { top: 5px; width: 10px; box-shadow: 0 3.5px 0 #fff; }
.logo::after { top: 12px; width: 6px; }
.panel-title { font-weight: 600; font-size: 13px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel-body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.panel-foot { display: flex; gap: 8px; justify-content: space-between; padding: 10px 12px; border-top: 1px solid var(--line); }
.hint { color: var(--muted); font-size: 12.5px; margin: 0; }
.notice { background: var(--soft); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }
.notice-warn { background: #fef3c7; color: #78350f; }
.row { display: flex; align-items: center; gap: 6px; }
.grow { flex: 1; min-width: 0; }
.count { font-weight: 600; }
.selector { font: 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--muted); word-break: break-all; }
.fields { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.field { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; }
.field:hover, .field:focus-within { border-color: #d97706; }
.field-sample { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.section-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }

input[type="text"], select {
  font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
  padding: 4px 6px; min-width: 0; height: 28px;
}
input[type="text"] { flex: 1; }
input[type="text"]:focus-visible, select:focus-visible, .btn:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 1px;
}
.btn {
  font: inherit; font-weight: 500; color: var(--fg); background: var(--bg); border: 1px solid var(--line);
  border-radius: 7px; padding: 5px 10px; cursor: pointer; white-space: nowrap; height: 30px;
}
.btn:hover { background: var(--soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: linear-gradient(135deg, #10b981, #0ea5a4 60%, #0ea5e9); border-color: transparent; color: #fff; box-shadow: 0 6px 16px -6px rgba(16, 169, 116, 0.7); }
.btn-primary:hover { background: linear-gradient(135deg, #0ea5a4, #0ea5e9); }
.btn-danger { background: #dc2626; border-color: #dc2626; color: #fff; }
.btn-danger:hover { background: #b91c1c; }
.btn-ghost { border-color: transparent; }
.btn-icon { width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; }
.btn-active { border-color: #d97706; color: #b45309; background: #fffbeb; }

.hud {
  position: fixed; left: 50%; top: 14px; transform: translateX(-50%); pointer-events: auto;
  display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px);
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 999px; padding: 6px 8px 6px 14px;
  box-shadow: 0 14px 36px -8px rgba(0, 0, 0, 0.3);
  animation: rowlio-drop 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.hud-brand { font-weight: 700; color: var(--accent); }
.hud-text { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hud-detail { color: var(--muted); white-space: nowrap; }
.hud .btn { height: 26px; padding: 2px 10px; border-radius: 999px; }
`;
