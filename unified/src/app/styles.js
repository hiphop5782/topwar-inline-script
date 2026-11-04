export const STYLES = `
#twu-alpha-root {
  position: fixed;
  top: 72px;
  right: 16px;
  z-index: 2147483647;
  width: 390px;
  max-height: calc(100vh - 88px);
  overflow: auto;
  color: #e5e7eb;
  background: rgba(15, 23, 42, .97);
  border: 1px solid #334155;
  border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .45);
  font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#twu-alpha-root * { box-sizing: border-box; }
#twu-alpha-root button, #twu-alpha-root input {
  font: inherit;
}
#twu-alpha-root button {
  border: 1px solid #475569;
  border-radius: 7px;
  padding: 7px 9px;
  color: #f8fafc;
  background: #1e293b;
  cursor: pointer;
}
#twu-alpha-root button:hover { background: #334155; }
#twu-alpha-root button:disabled { opacity: .45; cursor: not-allowed; }
#twu-alpha-root button[data-variant="primary"] { background: #2563eb; border-color: #3b82f6; }
#twu-alpha-root button[data-variant="danger"] { background: #991b1b; border-color: #dc2626; }
#twu-alpha-root input {
  min-width: 0;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid #475569;
  border-radius: 7px;
  color: #f8fafc;
  background: #0f172a;
}
#twu-alpha-root .twu-header {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #111827;
  border-bottom: 1px solid #334155;
}
#twu-alpha-root .twu-title { font-weight: 800; letter-spacing: .02em; }
#twu-alpha-root .twu-body { padding: 10px; display: grid; gap: 9px; }
#twu-alpha-root.twu-collapsed .twu-body { display: none; }
#twu-alpha-root .twu-section {
  padding: 10px;
  border: 1px solid #334155;
  border-radius: 9px;
  background: rgba(30, 41, 59, .55);
}
#twu-alpha-root .twu-section h3 { margin: 0 0 8px; font-size: 12px; color: #93c5fd; }
#twu-alpha-root .twu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#twu-alpha-root .twu-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
#twu-alpha-root .twu-field { display: grid; gap: 4px; margin-bottom: 6px; }
#twu-alpha-root .twu-field label { color: #94a3b8; }
#twu-alpha-root .twu-status { white-space: pre-wrap; word-break: break-word; color: #cbd5e1; }
#twu-alpha-root .twu-status[data-tone="error"] { color: #fca5a5; }
#twu-alpha-root .twu-status[data-tone="success"] { color: #86efac; }
#twu-alpha-root .twu-status[data-tone="warning"] { color: #fde68a; }
#twu-alpha-root .twu-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 7px; }
#twu-alpha-root .twu-metric { padding: 6px; border-radius: 6px; background: #0f172a; text-align: center; }
#twu-alpha-root .twu-metric strong { display: block; font-size: 15px; }
#twu-alpha-root .twu-logs { max-height: 130px; overflow: auto; display: grid; gap: 4px; }
#twu-alpha-root .twu-log { padding: 4px 6px; border-left: 2px solid #64748b; background: #0f172a; }
#twu-alpha-root .twu-log[data-level="error"] { border-color: #ef4444; }
#twu-alpha-root .twu-log[data-level="warn"] { border-color: #f59e0b; }
#twu-alpha-root .twu-log[data-level="info"] { border-color: #3b82f6; }
`;
