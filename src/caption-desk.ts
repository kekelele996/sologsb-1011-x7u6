import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  acquireSegmentLock,
  addConflict,
  applyRules,
  bumpRulesVersion,
  cloneModel,
  conflictLabel,
  createInitialModel,
  getLock,
  hydrateModel,
  isLockActive,
  LOCK_TTL_MS,
  PROOFREADERS,
  proofreaderById,
  queueOfflineChange,
  queueStats,
  releaseLock,
  renewLock,
  replayOfflineChanges,
  resolveConflict,
  normalizeNumbers,
  STORAGE_KEY,
  simulateLatency,
  toSrt,
  type CaptionSegment,
  type ConnectionState,
  type DeskModel,
  type Proofreader,
  type ReviewConflict,
  type SegmentLock,
  type SegmentState,
  type ToastMessage,
} from './model';

const HISTORY_LIMIT = 80;

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function formatAge(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒前`;
}

function formatLockCountdown(expiresAt: number): string {
  const seconds = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function stateLabel(state: SegmentState): string {
  return {
    pending: '待确认',
    confirmed: '已确认',
    duplicate: '重复片段',
    stale: '过期修改',
    ignored: '已忽略',
  }[state];
}

function connectionLabel(state: ConnectionState): string {
  return { connected: '连接稳定', degraded: '延迟波动', offline: '离线校正' }[state];
}

@customElement('caption-desk')
export class CaptionDesk extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      --caption-font-size: 18px;
      color: var(--cds-text-primary, #161616);
      background: var(--cds-background, #f4f4f4);
      font-family: "IBM Plex Sans", "PingFang SC", sans-serif;
    }

    * { box-sizing: border-box; }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto auto 1fr;
      background:
        linear-gradient(90deg, rgba(15,98,254,.025) 1px, transparent 1px),
        linear-gradient(rgba(15,98,254,.025) 1px, transparent 1px),
        var(--cds-background, #f4f4f4);
      background-size: 24px 24px;
    }

    .shell.dark {
      --cds-background: #161616;
      --cds-layer: #262626;
      --cds-layer-01: #262626;
      --cds-layer-02: #393939;
      --cds-field: #262626;
      --cds-text-primary: #f4f4f4;
      --cds-text-secondary: #c6c6c6;
      --cds-border-subtle: #393939;
      --cds-border-strong: #6f6f6f;
      color: #f4f4f4;
    }

    .topbar {
      min-height: 64px;
      padding: 8px 18px 8px 20px;
      display: grid;
      grid-template-columns: minmax(330px, 1fr) auto minmax(420px, 1fr);
      align-items: center;
      gap: 20px;
      background: #161616;
      color: #f4f4f4;
      border-bottom: 1px solid #393939;
      position: relative;
      z-index: 5;
    }

    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand-mark {
      width: 38px; height: 38px; display: grid; place-items: center;
      border: 1px solid #78a9ff; color: #78a9ff; font: 600 11px/1 "IBM Plex Mono", monospace;
      clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    }
    .brand-copy { min-width: 0; }
    .brand-copy strong { display: block; font-size: 15px; letter-spacing: .015em; white-space: nowrap; }
    .brand-copy span { display: block; color: #a8a8a8; font-size: 11px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .connection-pill {
      justify-self: center; display: flex; align-items: center; gap: 10px; padding: 8px 13px;
      min-width: 260px; background: #262626; border: 1px solid #525252;
    }
    .connection-dot { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 50%; background: #42be65; box-shadow: 0 0 0 4px rgba(66,190,101,.13); }
    .connection-pill.degraded .connection-dot { background: #f1c21b; box-shadow: 0 0 0 4px rgba(241,194,27,.14); }
    .connection-pill.offline .connection-dot { background: #fa4d56; box-shadow: 0 0 0 4px rgba(250,77,86,.14); }
    .connection-copy { min-width: 0; }
    .connection-copy strong { display: block; font-size: 12px; }
    .connection-copy small { display: block; color: #c6c6c6; margin-top: 2px; font-size: 10px; }

    .header-actions { justify-self: end; display: flex; align-items: center; gap: 8px; }
    .header-actions cds-button { --cds-button-primary: #0f62fe; }

    .status-strip {
      min-height: 60px; padding: 8px 20px; display: grid; grid-template-columns: 1.5fr repeat(4, minmax(118px, .6fr)) auto;
      gap: 0; align-items: stretch; background: var(--cds-layer, #fff); border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0);
    }
    .status-cell { padding: 7px 16px; border-right: 1px solid var(--cds-border-subtle, #e0e0e0); display: flex; flex-direction: column; justify-content: center; }
    .status-cell:first-child { padding-left: 4px; }
    .status-cell:last-child { border-right: 0; }
    .status-cell strong { font-size: 20px; font-weight: 400; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .status-cell span { margin-top: 3px; color: var(--cds-text-secondary, #525252); font-size: 10px; letter-spacing: .03em; }
    .status-cell.warning strong, .status-cell.warning span { color: #b28600; }
    .status-cell.danger strong, .status-cell.danger span { color: #da1e28; }
    .status-cell.hero strong { font-size: 14px; }
    .queue-track { width: 100%; height: 3px; margin-top: 6px; background: #e0e0e0; }
    .queue-track > span { display: block; height: 100%; background: #0f62fe; transition: width .3s ease; }
    .font-controls { min-width: 190px; padding: 7px 4px 7px 18px; display: flex; align-items: center; gap: 8px; }
    .font-controls label { color: var(--cds-text-secondary, #525252); font-size: 10px; }

    .workspace {
      min-height: 0; display: grid; grid-template-columns: minmax(390px, .95fr) minmax(430px, 1.05fr) minmax(370px, .9fr);
      gap: 1px; background: var(--cds-border-subtle, #e0e0e0); overflow: hidden;
    }

    .column { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--cds-background, #f4f4f4); }
    .column-head {
      min-height: 62px; padding: 11px 14px 9px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: var(--cds-layer, #fff); border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0);
    }
    .column-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
    .column-head p { margin: 4px 0 0; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .column-body { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-color: #8d8d8d transparent; }

    .segment-list { padding: 8px; display: flex; flex-direction: column; gap: 1px; }
    .segment-card {
      width: 100%; border: 0; border-left: 3px solid transparent; background: var(--cds-layer, #fff);
      color: inherit; text-align: left; padding: 11px 12px 10px 14px; cursor: pointer; position: relative;
    }
    .segment-card:hover { background: var(--cds-layer-hover, #e8e8e8); }
    .segment-card.selected { border-left-color: #0f62fe; background: var(--cds-layer-selected, #edf5ff); outline: 1px solid #78a9ff; }
    .segment-card.duplicate { border-left-color: #a56eff; }
    .segment-card.stale { border-left-color: #f1c21b; background: color-mix(in srgb, #fff 92%, #f1c21b 8%); }
    .segment-card.confirmed { border-left-color: #42be65; }
    .segment-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
    .segment-meta > span:first-child { color: var(--cds-text-secondary, #525252); font: 500 10px/1 "IBM Plex Mono", monospace; }
    .segment-state { font-size: 10px; color: #525252; }
    .segment-state.stale { color: #8d6e00; }
    .segment-state.duplicate { color: #6929c4; }
    .segment-state.confirmed { color: #198038; }
    .segment-text { margin: 0; font-size: var(--caption-font-size); line-height: 1.5; }
    .segment-corrected { margin: 6px 0 0; padding-left: 8px; border-left: 2px solid #42be65; color: #198038; font-size: calc(var(--caption-font-size) * .88); line-height: 1.45; }
    .segment-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .segment-foot b { color: #0f62fe; font-weight: 500; }
    .issue-note { margin-top: 8px; padding: 7px 8px; background: #fff8e1; border-left: 2px solid #f1c21b; color: #684e00; font-size: 10px; line-height: 1.45; }
    .duplicate-note { background: #f6f2ff; border-color: #a56eff; color: #491d8b; }

    .empty { padding: 48px 24px; text-align: center; color: var(--cds-text-secondary, #525252); }
    .empty strong { display: block; color: var(--cds-text-primary, #161616); margin-bottom: 6px; }
    .empty p { margin: 0; font-size: 11px; line-height: 1.5; }

    .editor-scroll { padding: 14px; overflow: auto; }
    .editor-card { background: var(--cds-layer, #fff); border: 1px solid var(--cds-border-subtle, #e0e0e0); }
    .editor-top { padding: 12px 14px; border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0); display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; }
    .editor-time { color: #0f62fe; font: 500 12px/1.4 "IBM Plex Mono", monospace; }
    .editor-title { margin: 4px 0 0; font-size: 12px; color: var(--cds-text-secondary, #525252); }
    .editor-status { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .editor-form { padding: 14px; display: flex; flex-direction: column; gap: 13px; }
    .form-grid { display: grid; grid-template-columns: minmax(130px, .6fr) 1fr; gap: 12px; align-items: end; }
    .caption-input { min-height: 158px; --cds-body-compact-01-font-size: var(--caption-font-size); --cds-body-compact-02-font-size: var(--caption-font-size); }
    .edit-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .edit-toolbar > span { margin-right: 5px; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .number-input { width: 110px; }
    .rule-suggestions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .rule-suggestions small { color: var(--cds-text-secondary, #525252); }
    .confirm-bar { padding: 12px 14px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--cds-border-subtle, #e0e0e0); background: var(--cds-layer-02, #f4f4f4); }
    .confirm-hint { color: var(--cds-text-secondary, #525252); font-size: 10px; line-height: 1.4; }
    .confirm-hint kbd { padding: 3px 5px; border: 1px solid var(--cds-border-strong, #8d8d8d); background: var(--cds-layer, #fff); color: var(--cds-text-primary, #161616); font: 10px/1 "IBM Plex Mono", monospace; }

    .inspector { padding: 12px 14px 20px; display: flex; flex-direction: column; gap: 14px; }
    .inspector-section { background: var(--cds-layer, #fff); border: 1px solid var(--cds-border-subtle, #e0e0e0); }
    .inspector-section-head { padding: 10px 12px; border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
    .inspector-section-head h3 { margin: 0; font-size: 12px; }
    .inspector-section-head span { color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .rule-list { padding: 5px 0; }
    .rule-item { padding: 8px 10px; display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; border-bottom: 1px solid var(--cds-border-subtle, #e0e0e0); }
    .rule-item:last-child { border-bottom: 0; }
    .rule-item strong { display: block; font-size: 11px; }
    .rule-item p { margin: 3px 0 0; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .rule-item-actions { display: flex; gap: 3px; }
    .rule-form { padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .rule-form cds-text-input, .rule-form cds-button { width: 100%; }
    .rule-form .full { grid-column: 1 / -1; }
    .live-timeline { padding: 6px 0; }
    .live-item { padding: 8px 11px; border-left: 3px solid #42be65; margin: 0 10px 7px; background: var(--cds-layer-02, #f4f4f4); }
    .live-item time { color: #198038; font: 500 9px/1 "IBM Plex Mono", monospace; }
    .live-item p { margin: 5px 0 0; font-size: var(--caption-font-size); line-height: 1.45; }
    .live-item small { display: block; margin-top: 4px; color: var(--cds-text-secondary, #525252); font-size: 9px; }
    .delivery-status { margin: 0 10px 10px; padding: 9px 10px; background: #edf5ff; border-left: 3px solid #0f62fe; color: #0043ce; font-size: 10px; line-height: 1.45; }

    .toast-stack { position: fixed; right: 18px; bottom: 18px; z-index: 20; width: 380px; display: flex; flex-direction: column; gap: 8px; }
    cds-toast-notification { box-shadow: 0 8px 22px rgba(0,0,0,.18); }

    .header-actions { gap: 10px; }
    .operator-switch { display: flex; align-items: center; gap: 8px; }
    .operator-switch > span { color: #c6c6c6; font-size: 10px; white-space: nowrap; }
    .operator-switch cds-dropdown { width: 178px; --cds-layer: #262626; }

    .segment-card[data-locked="true"] { background: color-mix(in srgb, var(--cds-layer, #fff) 94%, #0f62fe 6%); }
    .lock-chip {
      display: flex; align-items: center; gap: 7px; margin-bottom: 7px; padding: 4px 8px;
      font-size: 10px; border-left: 2px solid #8d8d8d; background: var(--cds-layer-02, #f4f4f4); color: var(--cds-text-secondary, #525252);
    }
    .lock-chip b { font-weight: 600; }
    .lock-chip .lock-dot { width: 7px; height: 7px; border-radius: 50%; background: #8d8d8d; flex: 0 0 auto; }
    .lock-chip.mine { border-left-color: #0f62fe; color: #0043ce; }
    .lock-chip.mine .lock-dot { background: #0f62fe; animation: lock-pulse 1.6s infinite; }
    .lock-chip.other { border-left-color: #8a3ffc; color: #6929c4; }
    .lock-chip.other .lock-dot { background: #8a3ffc; }
    .lock-chip.expired { border-left-color: #f1c21b; color: #8d6e00; }
    .lock-chip.expired .lock-dot { background: #f1c21b; }
    .lock-chip.provisional { font-style: italic; }
    @keyframes lock-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(15,98,254,.35); } 50% { box-shadow: 0 0 0 5px rgba(15,98,254,0); } }
    .conflict-flag { color: #da1e28 !important; font-weight: 600; }
    .handoff-note { background: #fff0f1 !important; border-color: #fa4d56 !important; color: #a2191f !important; }

    .lock-banner {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 9px 12px; border-left: 3px solid #8d8d8d; background: var(--cds-layer-02, #f4f4f4);
    }
    .lock-banner strong { display: block; font-size: 11px; }
    .lock-banner span { display: block; margin-top: 2px; color: var(--cds-text-secondary, #525252); font-size: 10px; }
    .lock-banner.mine { border-left-color: #0f62fe; background: #edf5ff; }
    .shell.dark .lock-banner.mine { background: #212f46; }
    .lock-banner.free { border-left-color: #393939; }
    .lock-banner-actions { display: flex; gap: 4px; flex: 0 0 auto; }

    .relay-section { border-color: #78a9ff; }
    .relay-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 14px; }
    .relay-block h4 { margin: 0 0 7px; font-size: 11px; display: flex; align-items: baseline; justify-content: space-between; }
    .relay-block h4 em { font-style: normal; color: var(--cds-text-secondary, #525252); font-size: 10px; font-weight: 400; }
    .relay-subnote { margin-top: 6px; font-size: 10px; color: var(--cds-text-secondary, #525252); display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .expired-pill { padding: 2px 7px; background: #fff8e1; color: #684e00; cursor: pointer; }
    .operator-row { display: grid; grid-template-columns: 56px 1fr; gap: 10px; align-items: start; padding: 6px 0; border-bottom: 1px dashed var(--cds-border-subtle, #e0e0e0); }
    .operator-row:last-child { border-bottom: 0; }
    .operator-row.current .operator-badge { box-shadow: 0 0 0 2px var(--op-color); }
    .operator-badge {
      display: inline-grid; place-items: center; padding: 3px 0; font-size: 10px; font-weight: 600;
      color: #fff; background: var(--op-color); border-radius: 2px;
    }
    .operator-locks { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .lock-line { font-size: 10px; color: var(--cds-text-secondary, #525252); cursor: pointer; }
    .lock-line b { color: #0f62fe; font-variant-numeric: tabular-nums; }
    .lock-line.active:hover { text-decoration: underline; }
    .lock-line.provisional { color: #8a3ffc; font-style: italic; }
    .lock-line.idle { cursor: default; }

    .outbox-list, .draft-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
    .outbox-list li, .draft-list li { padding: 7px 9px; background: var(--cds-layer-02, #f4f4f4); border-left: 2px solid #0f62fe; }
    .outbox-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 9px; color: var(--cds-text-secondary, #525252); margin-bottom: 4px; }
    .outbox-list p, .draft-list p { margin: 0 0 3px; font-size: 11px; line-height: 1.45; }
    .outbox-list small, .draft-list small { color: var(--cds-text-secondary, #525252); font-size: 9px; }
    .relay-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .relay-hint, .relay-empty { display: block; margin-top: 7px; font-size: 10px; color: var(--cds-text-secondary, #525252); line-height: 1.5; }

    .conflict-card { padding: 9px 10px; border: 1px solid #ffb3b8; border-left: 3px solid #da1e28; background: color-mix(in srgb, var(--cds-layer, #fff) 96%, #da1e28 4%); margin-bottom: 9px; }
    .conflict-card.loaded { border-color: #78a9ff; border-left-color: #0f62fe; }
    .conflict-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 9px; color: var(--cds-text-secondary, #525252); }
    .conflict-reason { margin: 6px 0 8px; font-size: 10px; color: #a2191f; line-height: 1.5; }
    .conflict-card.loaded .conflict-reason { color: #0043ce; }
    .conflict-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
    .diff-col { padding: 6px 8px; font-size: 10px; line-height: 1.45; }
    .diff-col span { display: block; font-size: 9px; margin-bottom: 3px; }
    .diff-col p { margin: 0; }
    .diff-col.incoming { background: #fff0f1; color: #161616; }
    .diff-col.incoming span { color: #a2191f; }
    .diff-col.current { background: var(--cds-layer-02, #f4f4f4); }
    .diff-col.current span { color: var(--cds-text-secondary, #525252); }
    .conflict-actions { display: flex; gap: 5px; flex-wrap: wrap; }
    .resolved-log { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .resolved-log small { color: var(--cds-text-secondary, #525252); font-size: 9px; }
    .resolved-pill { padding: 2px 7px; font-size: 9px; background: var(--cds-layer-02, #f4f4f4); color: var(--cds-text-secondary, #525252); }
    .resolved-pill.accepted-incoming { background: #defbe6; color: #198038; }

    .draft-list li { border-left-color: #8a3ffc; cursor: pointer; }
    .draft-head { font-size: 10px; color: #6929c4; margin-bottom: 3px; }
    .column-head-actions { display: flex; gap: 6px; }
    .demo-actions { margin-top: 8px; align-items: center; }
    .demo-actions small { color: var(--cds-text-secondary, #525252); font-size: 10px; }

    @media (max-width: 1280px) {
      .workspace { grid-template-columns: minmax(340px, .85fr) minmax(410px, 1fr) minmax(330px, .85fr); }
      .status-strip { grid-template-columns: 1.4fr repeat(4, minmax(100px, .55fr)); }
      .font-controls { display: none; }
    }

    @media (max-width: 980px) {
      .topbar { grid-template-columns: 1fr auto; }
      .connection-pill { grid-row: 2; grid-column: 1 / -1; justify-self: stretch; min-width: 0; }
      .workspace { grid-template-columns: 1fr; overflow: visible; }
      .column { min-height: 520px; }
      .shell { display: block; }
      .status-strip { grid-template-columns: repeat(4, 1fr); }
      .status-cell.hero { grid-column: 1 / -1; }
    }
  `;

  @state() private model: DeskModel = this.loadModel();
  @state() private dark = localStorage.getItem(`${STORAGE_KEY}-theme`) === 'dark';
  @state() private toasts: ToastMessage[] = [];
  @state() private ruleSource = '';
  @state() private ruleReplacement = '';
  @state() private ruleSpeaker = '';
  @state() private filter: 'active' | 'all' | 'attention' = 'active';
  @state() private showRuleForm = false;
  /** 仅驱动占用倒计时每秒刷新，不写草稿。 */
  @state() private clock = Date.now();
  private past: DeskModel[] = [];
  private future: DeskModel[] = [];
  private ticker?: number;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleShortcut);
    this.ticker = window.setInterval(() => {
      this.clock = Date.now();
      // 模拟实时流每 5 秒推进一次。
      if (Math.floor(this.clock / 5_000) !== Math.floor((this.clock - 1_000) / 5_000)) {
        const next = simulateLatency(this.model);
        const changed = JSON.stringify(next.segments) !== JSON.stringify(this.model.segments) || next.connection !== this.model.connection;
        if (changed) {
          this.model = next;
          this.persist();
        }
      }
    }, 1_000);
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.handleShortcut);
    if (this.ticker) window.clearInterval(this.ticker);
    super.disconnectedCallback();
  }

  private loadModel(): DeskModel {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = hydrateModel(JSON.parse(raw) as DeskModel);
        if (parsed.segments?.length) return parsed;
      }
    } catch {
      // 损坏草稿会回退到演示数据。
    }
    return createInitialModel();
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.model, updatedAt: Date.now() }));
  }

  private commit(label: string, update: (current: DeskModel) => DeskModel, toast = true): void {
    const previous = cloneModel(this.model);
    const next = update(cloneModel(this.model));
    next.updatedAt = Date.now();
    this.past = [...this.past, previous].slice(-HISTORY_LIMIT);
    this.future = [];
    this.model = next;
    this.persist();
    if (label && toast) this.pushToast('info', label, '已写入浏览器本地草稿');
  }

  private automatic(next: DeskModel): void {
    this.model = next;
    this.persist();
  }

  private undo(): void {
    const previous = this.past.pop();
    if (!previous) return this.pushToast('info', '没有可撤销的修改', '历史记录为空');
    this.future = [cloneModel(this.model), ...this.future].slice(0, HISTORY_LIMIT);
    this.model = previous;
    this.persist();
  }

  private redo(): void {
    const next = this.future.shift();
    if (!next) return;
    this.past = [...this.past, cloneModel(this.model)].slice(-HISTORY_LIMIT);
    this.model = next;
    this.persist();
  }

  private pushToast(kind: ToastMessage['kind'], title: string, subtitle: string): void {
    const toast = { id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind, title, subtitle };
    this.toasts = [toast, ...this.toasts].slice(0, 3);
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((item) => item.id !== toast.id);
    }, 4_500);
  }

  private get selected(): CaptionSegment | undefined {
    return this.model.segments.find((item) => item.id === this.model.selectedId);
  }

  private get operator(): Proofreader {
    return proofreaderById(this.model.currentOperatorId);
  }

  private get stats() {
    return queueStats(this.model, this.clock);
  }

  private lockOf(segmentId: string): SegmentLock | undefined {
    return getLock(this.model, segmentId);
  }

  private openConflictsFor(segmentId: string): ReviewConflict[] {
    return this.model.conflicts.filter((item) => item.segmentId === segmentId && (item.status === 'open' || item.status === 'loaded-to-editor'));
  }

  private switchOperator(operatorId: string): void {
    const operator = proofreaderById(operatorId);
    this.automatic({ ...this.model, currentOperatorId: operator.id });
    this.pushToast('info', `已切换为 ${operator.name}`, `${operator.role} · 仅能在自己的占用片段上保存`);
  }

  /**
   * 带占用与版本控制的片段修改。
   * - 在线：没有锁先占用；别人正式占用中或已过期都不能直接保存，
   *   过期须显式接管（避免误抢），原处理人提交会登记交接冲突。
   * - 离线：本地预占并把改动连同下手版本放进离线发件箱。
   */
  private mutateSelected(patch: Partial<CaptionSegment>, label = '', toast = true): boolean {
    const selected = this.selected;
    if (!selected) return false;
    const isTextEdit = patch.corrected !== undefined || patch.speaker !== undefined || patch.numberHints !== undefined;
    const offline = this.model.connection === 'offline';

    if (isTextEdit) {
      const lock = this.lockOf(selected.id);
      if (offline) {
        if (lock && lock.holderId !== this.operator.id && !lock.provisional) {
          this.recordHandoffConflict(selected, lock, patch, 'edit');
          return false;
        }
        const acquired = acquireSegmentLock(this.model, selected.id, this.operator, { provisional: true });
        if (acquired.ok) this.model = acquired.model;
      } else {
        if (lock && lock.holderId !== this.operator.id) {
          if (isLockActive(lock, this.clock)) {
            this.pushToast('error', `片段由 ${lock.holderName} 占用中`, `还剩 ${formatLockCountdown(lock.expiresAt)}，不能覆盖他人的修改`);
            return false;
          }
          this.pushToast('warning', `${lock.holderName} 的占用已过期`, '请先点「接管片段」再保存，交接内容会留档待复核');
          return false;
        }
        const acquired = acquireSegmentLock(this.model, selected.id, this.operator);
        if (!acquired.ok) {
          this.pushToast('error', `片段由 ${acquired.lock.holderName} 占用中`, '不能覆盖他人的修改');
          return false;
        }
        this.model = acquired.model;
      }
    }

    const nextSegment = { ...selected, ...patch, revision: selected.revision + 1 };
    this.commit(label, (current) => {
      let next: DeskModel = {
        ...current,
        segments: current.segments.map((item) => item.id === selected.id ? nextSegment : item),
      };
      if (isTextEdit && offline) {
        next = queueOfflineChange(next, {
          segment: nextSegment,
          kind: 'edit',
          speaker: nextSegment.speaker,
          corrected: nextSegment.corrected,
          numberHints: nextSegment.numberHints,
        });
      }
      if (isTextEdit && !offline) {
        next = renewLock(next, selected.id, this.operator.id, LOCK_TTL_MS, Date.now());
      }
      return next;
    }, toast);
    return true;
  }

  /** 原处理人占用失效（被别人持有或已被接管）后仍提交：登记交接冲突，待复核内容原样保留。 */
  private recordHandoffConflict(segment: CaptionSegment, lock: SegmentLock, patch: Partial<CaptionSegment>, kind: 'edit' | 'confirm', extra?: { corrected?: string; speaker?: string }): void {
    const incomingText = extra?.corrected ?? patch.corrected ?? segment.corrected;
    const incomingSpeaker = extra?.speaker ?? patch.speaker ?? segment.speaker;
    const reason = lock.holderId === this.operator.id
      ? `占用已过期并由 ${lock.holderName} 一方接手，提交不能覆盖接手后的内容`
      : `片段在你下手后被 ${lock.holderName} 占用校对，提交已拦截`;
    this.commit('检测到交接冲突', (current) => {
      const result = addConflict(current, {
        kind: 'handoff',
        segment: current.segments.find((item) => item.id === segment.id) ?? segment,
        operator: this.operator,
        reason,
        incomingText,
        incomingSpeaker,
        incomingKind: kind,
      });
      return result.model;
    });
    this.pushToast('error', '交接冲突：提交已拦截', '你的内容已保留在右侧「冲突复核」，不会覆盖接手人的修改');
  }

  /**
   * 模拟原占用者占用过期/被接管后又提交了一版（交班场景的核心冲突）。
   * 提交不写入片段，直接登记交接冲突并保留待复核内容。
   */
  private simulateStaleResubmit(): void {
    const selected = this.selected;
    if (!selected) return;
    const lock = this.lockOf(selected.id);
    if (!lock) {
      this.pushToast('info', '当前片段没有历史占用', '先让一位校对员占用并过期、再由他人接管，才能模拟交班冲突');
      return;
    }
    const originalHolder = proofreaderById(PROOFREADERS.find((op) => op.id !== this.operator.id)!.id);
    const staleText = `${selected.corrected}（${originalHolder.name} 在失去占用后补提交）`;
    this.commit('原处理人过期后再提交，已拦截', (current) => {
      const withLock: DeskModel = {
        ...current,
        // 把占用还原成「曾由原处理人持有、现已过期」的状态用于冲突说明。
        locks: current.locks.map((item) => item.segmentId === selected.id
          ? { ...item, holderId: originalHolder.id, holderName: originalHolder.name, expiresAt: Date.now() - 1_000, provisional: undefined }
          : item),
      };
      const result = addConflict(withLock, {
        kind: 'handoff',
        segment: withLock.segments.find((item) => item.id === selected.id) ?? selected,
        operator: originalHolder,
        reason: `占用到期后片段已交给 ${this.operator.name} 接手，晚到的提交不能覆盖接手后的内容`,
        incomingText: staleText,
        incomingSpeaker: selected.speaker,
        incomingKind: 'edit',
      });
      return result.model;
    }, false);
    this.pushToast('error', `已拦截 ${originalHolder.name} 的晚到提交`, '内容保留在「冲突复核」队列，按顺序等待人工裁决');
  }

  private acquireSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    const offline = this.model.connection === 'offline';
    const outcome = acquireSegmentLock(this.model, selected.id, this.operator, { provisional: offline });
    if (!outcome.ok) {
      this.pushToast('warning', `片段由 ${outcome.lock.holderName} 占用中`, `还剩 ${formatLockCountdown(outcome.lock.expiresAt)}，过期后才能接管`);
      return;
    }
    this.automatic(outcome.model);
    if (outcome.action === 'taken-over') {
      this.pushToast('warning', `已接管 ${outcome.draft?.fromOperatorName ?? '原校对员'} 的片段`, '其未提交内容已留档，可在「交接留档」查看');
    } else if (outcome.action === 'renewed') {
      this.pushToast('info', '占用已续期', `再持有 ${Math.round(LOCK_TTL_MS / 1000)} 秒`);
    } else {
      this.pushToast('success', '已占用该片段', `限时 ${Math.round(LOCK_TTL_MS / 1000)} 秒，编辑会自动续期`);
    }
  }

  private renewSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    const lock = this.lockOf(selected.id);
    if (!lock || lock.holderId !== this.operator.id) return;
    this.automatic(renewLock(this.model, selected.id, this.operator.id));
    this.pushToast('info', '占用已续期', `再持有 ${Math.round(LOCK_TTL_MS / 1000)} 秒`);
  }

  private releaseSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    this.automatic(releaseLock(this.model, selected.id, this.operator.id));
    this.pushToast('info', '已释放占用', '其他校对员现在可以接手该片段');
  }

  private get pendingSegments(): CaptionSegment[] {
    const items = this.model.segments.filter((item) => {
      if (this.filter === 'active') return item.state === 'pending' || item.state === 'stale' || item.state === 'duplicate';
      if (this.filter === 'attention') return item.state === 'stale' || item.state === 'duplicate';
      return true;
    });
    return [...items].sort((a, b) => a.sequence - b.sequence);
  }

  private updateSelected(patch: Partial<CaptionSegment>, label = '', toast = true): boolean {
    return this.mutateSelected(patch, label, toast);
  }

  private selectSegment(id: string): void {
    this.model = { ...this.model, selectedId: id };
    this.persist();
  }

  private navigate(direction: number): void {
    const candidates = this.pendingSegments.length ? this.pendingSegments : [...this.model.segments].sort((a, b) => a.sequence - b.sequence);
    const index = candidates.findIndex((item) => item.id === this.model.selectedId);
    const next = candidates[Math.max(0, Math.min(candidates.length - 1, index + direction))];
    if (next) this.selectSegment(next.id);
  }

  private applyTerm(ruleId: string): void {
    const selected = this.selected;
    const rule = this.model.rules.find((item) => item.id === ruleId);
    if (!selected || !rule) return;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(rule.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (!expression.test(selected.corrected)) {
      this.pushToast('warning', '当前字幕没有该术语', `${rule.source} → ${rule.replacement}`);
      return;
    }
    const value = selected.corrected.replace(expression, rule.replacement);
    if (!this.updateSelected({ corrected: value }, '应用术语替换')) return;
    this.commit('术语使用计数 +1', (current) => ({
      ...current,
      rules: current.rules.map((item) => item.id === rule.id ? { ...item, usageCount: item.usageCount + 1 } : item),
    }));
  }

  private applyInlineEdit(transform: (value: string) => string, label: string, cursorShift = 0): void {
    const selected = this.selected;
    if (!selected) return;
    const host = this.renderRoot.querySelector('cds-textarea');
    const textarea = host?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | undefined;
    let value = selected.corrected;
    let cursor = value.length;

    if (textarea) {
      value = `${value.slice(0, textarea.selectionStart)}${transform('')}${value.slice(textarea.selectionEnd)}`;
      cursor = textarea.selectionStart + transform('').length + cursorShift;
    } else {
      value = transform(value);
    }

    this.updateSelected({ corrected: value }, label);
    this.updateComplete.then(() => {
      const nextTextarea = this.renderRoot.querySelector('cds-textarea')?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | undefined;
      if (nextTextarea && textarea) {
        nextTextarea.focus();
        nextTextarea.setSelectionRange(cursor, cursor);
      }
    });
  }

  private insertPunctuation(mark: string): void {
    this.applyInlineEdit(() => mark, `插入${mark}`);
  }

  private wrapSelection(open: string, close: string): void {
    const host = this.renderRoot.querySelector('cds-textarea');
    const textarea = host?.shadowRoot?.querySelector('textarea') as HTMLTextAreaElement | undefined;
    const selected = this.selected;
    if (!textarea || !selected) return;
    const selectedText = selected.corrected.slice(textarea.selectionStart, textarea.selectionEnd) || '重点';
    const value = `${selected.corrected.slice(0, textarea.selectionStart)}${open}${selectedText}${close}${selected.corrected.slice(textarea.selectionEnd)}`;
    this.updateSelected({ corrected: value }, '添加强调标点');
  }

  private normalizeCurrentNumbers(): void {
    const selected = this.selected;
    if (!selected) return;
    const normalized = normalizeNumbers(selected.corrected);
    if (normalized === selected.corrected) {
      this.pushToast('info', '没有需要规范化的数字', '已检查全角数字和中文数字');
      return;
    }
    this.updateSelected({ corrected: normalized, numberHints: normalized }, '规范化数字');
  }

  private confirmSelected(): void {
    const selected = this.selected;
    if (!selected) {
      this.pushToast('warning', '没有可确认的片段', '请先从待确认区选择字幕');
      return;
    }
    if (selected.state === 'confirmed') {
      this.pushToast('info', '该片段已在直播区', '无需重复确认');
      return;
    }
    const { text, used } = applyRules(selected.corrected, this.model);
    const offline = this.model.connection === 'offline';
    const lock = this.lockOf(selected.id);

    // 交接保护：占用已不属于当前校对员时，确认不能直接覆盖。
    if (lock && lock.holderId !== this.operator.id) {
      if (offline && !lock.provisional) {
        this.recordHandoffConflict(selected, lock, { corrected: text, speaker: selected.speaker }, 'confirm');
        return;
      }
      if (!offline) {
        if (isLockActive(lock, this.clock)) {
          this.pushToast('error', `片段由 ${lock.holderName} 占用中`, `还剩 ${formatLockCountdown(lock.expiresAt)}，请由占用方确认或等待过期接管`);
          return;
        }
        this.pushToast('warning', `${lock.holderName} 的占用已过期`, '请先「接管片段」再确认，原处理人的内容会保留待复核');
        return;
      }
    }

    if (offline) {
      // 离线确认不直接进直播区：带着下手版本进入发件箱，恢复后按序回放。
      this.commit('已加入离线发件箱', (current) => {
        let next: DeskModel = {
          ...current,
          segments: current.segments.map((item) => item.id === selected.id ? { ...item, corrected: text, revision: item.revision + 1 } : item),
          rules: current.rules.map((rule) => used.includes(rule.id) ? { ...rule, usageCount: rule.usageCount + 1 } : rule),
        };
        const queuedSegment = next.segments.find((item) => item.id === selected.id) ?? selected;
        next = queueOfflineChange(next, {
          segment: queuedSegment,
          kind: 'confirm',
          speaker: queuedSegment.speaker,
          corrected: text,
          numberHints: queuedSegment.numberHints,
          usedRules: used,
        });
        return next;
      }, false);
      this.pushToast('warning', '已加入离线发件箱', '确认内容带着下手时的版本暂存，恢复连接并回放后才决定是否进直播区');
      return;
    }

    const outcome = acquireSegmentLock(this.model, selected.id, this.operator);
    if (!outcome.ok) {
      this.pushToast('error', `片段由 ${outcome.lock.holderName} 占用中`, '不能覆盖他人的修改');
      return;
    }
    const nextOrder = this.pendingSegments.filter((item) => item.id !== selected.id);
    this.model = outcome.model;
    this.commit('确认并送入直播区', (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? {
        ...item,
        corrected: text,
        state: 'confirmed',
        source: item.source === 'manual' ? 'manual' : 'live',
        confirmedAt: Date.now(),
        confirmedBy: this.operator.name,
        staleReason: item.state === 'stale' ? item.staleReason : undefined,
        tags: used.length ? [...new Set([...item.tags, '术语已应用'])] : item.tags,
        revision: item.revision + 1,
      } : item),
      rules: current.rules.map((rule) => used.includes(rule.id) ? { ...rule, usageCount: rule.usageCount + 1 } : rule),
      selectedId: nextOrder[0]?.id ?? selected.id,
      locks: current.locks.filter((item) => item.segmentId !== selected.id),
    }), false);
    this.pushToast('success', '字幕已进入直播区', `第 ${selected.sequence} 段由 ${this.operator.name} 确认`);
  }

  private ignoreSelected(): void {
    const selected = this.selected;
    if (!selected) return;
    const lock = this.lockOf(selected.id);
    if (lock && lock.holderId !== this.operator.id && isLockActive(lock, this.clock)) {
      this.pushToast('warning', `片段由 ${lock.holderName} 占用中`, '不能忽略他人正在校对的片段');
      return;
    }
    const next = this.pendingSegments.find((item) => item.id !== selected.id);
    this.commit('忽略问题片段', (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? { ...item, state: 'ignored', staleReason: '已人工忽略' } : item),
      selectedId: next?.id ?? selected.id,
      locks: current.locks.filter((item) => item.segmentId !== selected.id),
    }));
  }

  private recoverDuplicate(): void {
    const selected = this.selected;
    if (!selected) return;
    this.commit('保留重复片段', (current) => ({
      ...current,
      segments: current.segments.map((item) => item.id === selected.id ? { ...item, state: 'pending', duplicateOf: undefined, staleReason: '重复提示已由校对员确认保留' } : item),
    }));
  }

  private setConnection(connection: ConnectionState): void {
    this.commit(connection === 'offline' ? '切换到离线校正' : connection === 'degraded' ? '模拟延迟波动' : '连接已恢复（尚未回放发件箱）', (current) => ({
      ...current,
      connection,
      simulatedDelay: connection === 'connected' ? Math.max(0.8, current.simulatedDelay - 0.7) : connection === 'degraded' ? 4.6 : current.simulatedDelay,
    }));
    if (connection === 'offline') {
      this.pushToast('info', '离线校正已开始', '改动会带着下手时的片段版本和术语版本暂存，恢复后按顺序回放');
    }
  }

  /** 恢复连接（不回放）：模拟网络回来，发件箱仍保留，由校对员择机回放。 */
  private reconnect(): void {
    this.setConnection('connected');
  }

  /** 按发生顺序回放离线发件箱，无法直接合并的旧改动进入冲突复核队列。 */
  private replayOutbox(): void {
    if (!this.model.offlineChanges.length) {
      this.pushToast('info', '发件箱为空', '没有待回放的离线改动');
      return;
    }
    const beforeOpen = this.model.conflicts.filter((item) => item.status === 'open').length;
    const outboxSize = this.model.offlineChanges.length;
    const replayed = replayOfflineChanges(this.model);
    this.past = [...this.past, cloneModel(this.model)].slice(-HISTORY_LIMIT);
    this.future = [];
    this.model = replayed;
    this.persist();
    const openConflicts = this.model.conflicts.filter((item) => item.status === 'open').length;
    const applied = outboxSize - this.model.offlineChanges.length;
    if (openConflicts > beforeOpen) {
      this.pushToast('warning', `回放完成：${applied} 条已合并，${openConflicts - beforeOpen} 条冲突待复核`, '已被确认、版本过期或术语版本变化的旧改动没有直接进直播区');
    } else {
      this.pushToast('success', '离线发件箱已按顺序回放', `${applied} 条改动完成合并，无冲突`);
    }
  }

  private decideConflict(conflictId: string, decision: 'keep-current' | 'take-incoming' | 'load-to-editor'): void {
    const labels = { 'keep-current': '保留现有版本', 'take-incoming': '采用待复核内容', 'load-to-editor': '载入编辑台' } as const;
    this.commit(`冲突已裁决：${labels[decision]}`, (current) => resolveConflict(current, conflictId, decision, this.operator), false);
    const conflict = this.model.conflicts.find((item) => item.id === conflictId);
    if (decision === 'load-to-editor' && conflict) {
      this.pushToast('info', '待复核内容已载入编辑台', `第 ${conflict.sequence} 段：确认无误后再手动送入直播区`);
    } else {
      this.pushToast('success', `冲突 #${conflict?.index ?? ''} 处理完成`, labels[decision]);
    }
  }


  private addRuleFromSelection(): void {
    const selected = this.selected;
    if (!selected) return;
    this.ruleSource = selected.corrected.length > 24 ? selected.corrected.slice(0, 24) : selected.corrected;
    this.ruleReplacement = selected.corrected;
    this.ruleSpeaker = selected.speaker;
    this.showRuleForm = true;
  }

  private addRule(): void {
    const source = this.ruleSource.trim();
    const replacement = this.ruleReplacement.trim();
    if (!source || !replacement) {
      this.pushToast('warning', '规则不完整', '原文和替换文本均不能为空');
      return;
    }
    this.commit('新增术语快捷规则（规则版本已递增）', (current) => bumpRulesVersion({
      ...current,
      rules: [{
        id: `term-${Date.now().toString(36)}`,
        source,
        replacement,
        speaker: this.ruleSpeaker,
        enabled: true,
        caseSensitive: false,
        usageCount: 0,
        createdAt: Date.now(),
      }, ...current.rules],
    }));
    this.ruleSource = '';
    this.ruleReplacement = '';
    this.ruleSpeaker = '';
    this.showRuleForm = false;
  }

  private deleteRule(id: string): void {
    this.commit('删除术语规则（规则版本已递增）', (current) => bumpRulesVersion({ ...current, rules: current.rules.filter((item) => item.id !== id) }));
  }

  private exportSrt(): void {
    const content = toSrt(this.model);
    if (!content) {
      this.pushToast('warning', '暂无已确认字幕', '先确认至少一个片段再导出');
      return;
    }
    const blob = new Blob([content], { type: 'application/x-subrip;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.model.eventName.replace(/[^\p{L}\p{N}-]+/gu, '-')}.srt`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.pushToast('success', 'SRT 已导出', `${toSrt(this.model).split('\n\n').length} 段字幕`);
  }

  private adjustFont(delta: number): void {
    const fontSize = Math.max(14, Math.min(28, this.model.fontSize + delta));
    this.automatic({ ...this.model, fontSize });
  }

  private toggleTheme(): void {
    this.dark = !this.dark;
    localStorage.setItem(`${STORAGE_KEY}-theme`, this.dark ? 'dark' : 'light');
  }

  private handleShortcut = (event: KeyboardEvent): void => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLocaleLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (modifier && event.key.toLocaleLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      this.confirmSelected();
      return;
    }
    if (event.altKey && event.key.toLocaleLowerCase() === 'j') {
      event.preventDefault();
      this.navigate(1);
      return;
    }
    if (event.altKey && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      this.navigate(-1);
      return;
    }
    const punctuation: Record<string, string> = { '1': '，', '2': '。', '3': '？', '4': '！' };
    if (modifier && punctuation[event.key]) {
      event.preventDefault();
      this.insertPunctuation(punctuation[event.key]);
    }
  };

  private renderPendingList() {
    const segments = this.pendingSegments;
    if (!segments.length) {
      return html`<div class="empty"><strong>待确认区已清空</strong><p>新的实时片段到达时会自动进入这里。</p></div>`;
    }
    return html`
      <div class="segment-list">
        ${segments.map((item) => {
          const lock = this.lockOf(item.id);
          const active = isLockActive(lock, this.clock);
          const expired = lock && !active;
          const mine = lock?.holderId === this.operator.id;
          return html`
          <button class="segment-card ${item.id === this.model.selectedId ? 'selected' : ''} ${item.state}" ?data-locked=${active && !mine} @click=${() => this.selectSegment(item.id)}>
            <div class="segment-meta">
              <span>${formatClock(item.startTime)} · #${String(item.sequence).padStart(3, '0')}</span>
              <span class="segment-state ${item.state}">${stateLabel(item.state)}</span>
            </div>
            ${lock ? html`
              <div class="lock-chip ${active ? (mine ? 'mine' : 'other') : 'expired'} ${lock.provisional ? 'provisional' : ''}">
                <span class="lock-dot"></span>
                ${active
                  ? html`<b>${mine ? '你' : lock.holderName}</b> 正在校对 · 剩 ${formatLockCountdown(lock.expiresAt)}${lock.provisional ? ' · 离线预占' : ''}`
                  : html`<b>${lock.holderName}</b> 的占用已过期 · 可接管${lock.provisional ? ' · 离线预占' : ''}`}
              </div>` : nothing}
            <p class="segment-text">${item.original}</p>
            ${item.corrected !== item.original ? html`<p class="segment-corrected">${item.corrected}</p>` : nothing}
            <div class="segment-foot">
              <span>${item.speaker}</span>
              <span>·</span>
              <span>${formatAge(item.receivedAt)}</span>
              ${item.revision > 0 ? html`<span>· <b>修改 ${item.revision} 次</b></span>` : nothing}
              ${this.openConflictsFor(item.id).length ? html`<span class="conflict-flag">· ${this.openConflictsFor(item.id).length} 条冲突待复核</span>` : nothing}
            </div>
            ${item.state === 'stale' && item.staleReason ? html`<div class="issue-note">${item.staleReason}。确认前请核对直播上下文。</div>` : nothing}
            ${item.state === 'duplicate' ? html`<div class="issue-note duplicate-note">${item.staleReason || '检测到重复片段'}，请保留或忽略。</div>` : nothing}
            ${expired ? html`<div class="issue-note handoff-note">${lock.holderName} 的占用已到期，点编辑台「接管片段」接手；其再提交会进入冲突复核。</div>` : nothing}
          </button>`;
        })}
      </div>
    `;
  }

  private renderLockBanner(item: CaptionSegment, lock: SegmentLock | undefined, active: boolean, mine: boolean) {
    const offline = this.model.connection === 'offline';
    if (lock && active && !mine) {
      return html`
        <cds-inline-notification kind="info" low-contrast title="片段被他人占用"
          subtitle=${`${lock.holderName} 正在校对，还剩 ${formatLockCountdown(lock.expiresAt)}。占用到期后可以接管，不能直接覆盖。`}>
        </cds-inline-notification>`;
    }
    if (lock && !active) {
      return html`
        <cds-inline-notification kind="warning" low-contrast title="占用已过期，可以接管"
          subtitle=${`${lock.holderName} 的占用已于 ${formatTime(lock.expiresAt)} 到期。接管会保留其手头内容作为交接留档；若其随后再提交，会进入冲突复核而不是覆盖你。`}>
          <cds-button slot="action" size="sm" kind="primary" @click=${this.acquireSelected}>接管片段</cds-button>
        </cds-inline-notification>
        <div class="relay-actions demo-actions">
          <small>交班演练：</small>
          <cds-button kind="danger--tertiary" size="sm" @click=${this.simulateStaleResubmit}>模拟 ${lock.holderName} 过期后再提交</cds-button>
        </div>`;
    }
    if (lock && mine) {
      return html`
        <div class="lock-banner mine">
          <div><strong>你正在占用此片段</strong><span>剩余 ${formatLockCountdown(lock.expiresAt)} · 编辑会自动续期${lock.provisional ? ' · 当前为离线预占，恢复后不自动转正' : ''}</span></div>
          <div class="lock-banner-actions">
            <cds-button kind="ghost" size="sm" @click=${this.renewSelected}>续期</cds-button>
            <cds-button kind="danger--ghost" size="sm" @click=${this.releaseSelected}>交班释放</cds-button>
          </div>
        </div>`;
    }
    return html`
      <div class="lock-banner free">
        <div><strong>${offline ? '离线期间为本地预占' : '片段暂无人占用'}</strong><span>${offline ? '恢复连接后需要重新占用才能提交' : `开始修改即自动占用 ${Math.round(LOCK_TTL_MS / 1000)} 秒`}</span></div>
        <cds-button kind="tertiary" size="sm" @click=${this.acquireSelected}>${item.state === 'confirmed' ? '占用以继续校对' : '占用片段'}</cds-button>
      </div>`;
  }

  private renderEditor() {
    const item = this.selected;
    if (!item) {
      return html`<div class="empty"><strong>选择一条待确认字幕</strong><p>可以使用 Alt+J / Alt+K 在片段之间移动。</p></div>`;
    }
    const applicableRules = this.model.rules.filter((rule) => rule.enabled && (!rule.speaker || rule.speaker === item.speaker));
    const lock = this.lockOf(item.id);
    const active = isLockActive(lock, this.clock) || (this.model.connection === 'offline' && lock?.provisional === true && lock.holderId === this.operator.id);
    const mine = lock?.holderId === this.operator.id;
    const readOnly = !!lock && !mine && isLockActive(lock, this.clock);
    const segmentConflicts = this.openConflictsFor(item.id);
    return html`
      <div class="editor-scroll">
        <div class="editor-card">
          <div class="editor-top">
            <div>
              <div class="editor-time">${formatClock(item.startTime)} — ${formatClock(item.startTime + 7)}</div>
              <p class="editor-title">实时片段 #${String(item.sequence).padStart(3, '0')} · 到达于 ${formatAge(item.receivedAt)}</p>
            </div>
            <div class="editor-status">
              <cds-tag type=${item.state === 'stale' ? 'warm-gray' : item.state === 'duplicate' ? 'purple' : item.state === 'confirmed' ? 'green' : 'blue'} size="sm">${stateLabel(item.state)}</cds-tag>
              <cds-tag type="outline" size="sm">版本 v${item.revision}</cds-tag>
              <cds-tag type="outline" size="sm">规则 v${this.model.rulesVersion}</cds-tag>
            </div>
          </div>
          <div class="editor-form">
            ${this.renderLockBanner(item, lock, active, mine)}
            ${segmentConflicts.length ? html`
              <cds-inline-notification kind="error" low-contrast title="该片段有待复核冲突"
                subtitle=${`${segmentConflicts.length} 条接力/离线冲突未裁决，旧改动未进入直播区，请在右侧冲突复核中处理。`}>
              </cds-inline-notification>` : nothing}
            ${item.state === 'duplicate' ? html`
              <cds-inline-notification kind="warning" low-contrast title="重复片段提示" subtitle=${item.staleReason || '与已确认片段高度相似'}>
                <cds-button slot="action" size="sm" @click=${this.recoverDuplicate} ?disabled=${readOnly}>保留并继续校对</cds-button>
              </cds-inline-notification>
            ` : nothing}
            ${item.state === 'stale' ? html`
              <cds-inline-notification kind="warning" low-contrast title="过期修改" subtitle=${`${item.staleReason || '该片段已超过 90 秒未确认'}。请结合上下文确认，或忽略以避免污染直播区。`}></cds-inline-notification>
            ` : nothing}
            <div class="form-grid">
              <cds-select label-text="发言人" value=${item.speaker} ?disabled=${readOnly} @cds-select-selected=${(event: CustomEvent<{ value: string }>) => this.updateSelected({ speaker: event.detail.value }, '修改发言人')}>
                ${['主持人', '主讲人', '嘉宾 / 周然', '现场提问', '未知发言人'].map((speaker) => html`<cds-select-item value=${speaker}>${speaker}</cds-select-item>`)}
              </cds-select>
              <cds-number-input class="number-input" label="延迟（秒）" .value=${this.model.simulatedDelay} step="0.1" min="0" max="9" @input=${(event: Event) => this.automatic({ ...this.model, simulatedDelay: Number((event.currentTarget as any).value) })}></cds-number-input>
            </div>
            <cds-textarea
              class="caption-input"
              label-text="校对后的字幕文本"
              helper-text=${readOnly ? `只读：${lock?.holderName} 占用中，到期接管后才能修改` : 'Ctrl/⌘ + 1–4 快速插入标点；保存即占用/续期；离线时改动进入发件箱'}
              .value=${item.corrected}
              ?readonly=${readOnly}
              ?disabled=${readOnly}
              @input=${(event: Event) => this.updateSelected({ corrected: (event.currentTarget as any).value }, '', false)}
            ></cds-textarea>
            <div class="edit-toolbar">
              <span>快速标点</span>
              <cds-button kind="ghost" size="sm" ?disabled=${readOnly} @click=${() => this.insertPunctuation('，')}>，逗号</cds-button>
              <cds-button kind="ghost" size="sm" ?disabled=${readOnly} @click=${() => this.insertPunctuation('。')}>。句号</cds-button>
              <cds-button kind="ghost" size="sm" ?disabled=${readOnly} @click=${() => this.insertPunctuation('？')}>？问号</cds-button>
              <cds-button kind="ghost" size="sm" ?disabled=${readOnly} @click=${() => this.insertPunctuation('…')}>…省略</cds-button>
              <cds-button kind="ghost" size="sm" ?disabled=${readOnly} @click=${() => this.wrapSelection('（', '）')}>（）括注</cds-button>
              <cds-button kind="secondary" size="sm" ?disabled=${readOnly} @click=${this.normalizeCurrentNumbers}>规范化数字</cds-button>
            </div>
            <div class="rule-suggestions">
              <small>术语快捷替换</small>
              ${applicableRules.length ? applicableRules.map((rule) => html`
                <cds-button kind="tertiary" size="sm" ?disabled=${readOnly} @click=${() => this.applyTerm(rule.id)}>${rule.source} → ${rule.replacement}</cds-button>
              `) : html`<small>当前发言人的规则为空</small>`}
              <cds-button kind="ghost" size="sm" ?disabled=${readOnly} @click=${this.addRuleFromSelection}>＋ 从当前文本新建</cds-button>
            </div>
          </div>
          <div class="confirm-bar">
            <div class="confirm-hint"><kbd>⌘/Ctrl Enter</kbd> 确认并进入直播区 · <kbd>Alt J/K</kbd> 切换片段 · ${this.model.connection === 'offline' ? '确认将带着版本进入离线发件箱' : '只有自己占用的片段才能确认'}</div>
            <div>
              <cds-button kind="danger--tertiary" size="sm" ?disabled=${readOnly} @click=${this.ignoreSelected}>忽略片段</cds-button>
              <cds-button kind="primary" ?disabled=${readOnly} @click=${this.confirmSelected}>${this.model.connection === 'offline' ? '确认并暂存发件箱' : '确认并送入直播区'}</cds-button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderRelayPanel() {
    const at = this.clock;
    const activeLocks = this.model.locks
      .filter((lock) => !lock.provisional && lock.expiresAt > at)
      .sort((a, b) => a.expiresAt - b.expiresAt);
    const expiredLocks = this.model.locks.filter((lock) => lock.expiresAt <= at);
    const provisionalLocks = this.model.locks.filter((lock) => lock.provisional);
    const orderedChanges = [...this.model.offlineChanges].sort((a, b) => a.createdAt - b.createdAt);
    const openConflicts = [...this.model.conflicts]
      .filter((conflict) => conflict.status === 'open' || conflict.status === 'loaded-to-editor')
      .sort((a, b) => a.occurredAt - b.occurredAt || a.index - b.index);
    const resolvedConflicts = this.model.conflicts.filter((conflict) => conflict.status.startsWith('accepted')).slice(-6);
    const drafts = [...this.model.handoffDrafts].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 8);

    const segmentOf = (id: string) => this.model.segments.find((item) => item.id === id);

    return html`
      <section class="inspector-section relay-section">
        <div class="inspector-section-head">
          <h3>接力校对</h3>
          <span>${activeLocks.length} 段占用中 · ${openConflicts.length} 条冲突</span>
        </div>
        <div class="relay-body">
          <div class="relay-block">
            <h4>各校对员正在处理的片段</h4>
            ${PROOFREADERS.map((op) => {
              const opLocks = activeLocks.filter((lock) => lock.holderId === op.id);
              const opProvisional = provisionalLocks.filter((lock) => lock.holderId === op.id);
              return html`
                <div class="operator-row ${op.id === this.operator.id ? 'current' : ''}">
                  <span class="operator-badge" style=${`--op-color: ${op.color}`}>${op.name}</span>
                  <div class="operator-locks">
                    ${opLocks.length ? opLocks.map((lock) => html`
                      <div class="lock-line active" @click=${() => this.selectSegment(lock.segmentId)}>
                        #${segmentOf(lock.segmentId)?.sequence ?? '?'} · 剩 <b>${formatLockCountdown(lock.expiresAt)}</b>
                      </div>`) : nothing}
                    ${opProvisional.map((lock) => html`
                      <div class="lock-line provisional" @click=${() => this.selectSegment(lock.segmentId)}>
                        #${segmentOf(lock.segmentId)?.sequence ?? '?'} · 离线预占
                      </div>`)}
                    ${!opLocks.length && !opProvisional.length ? html`<span class="lock-line idle">空闲</span>` : nothing}
                  </div>
                </div>`;
            })}
            ${expiredLocks.length ? html`<div class="relay-subnote">已过期占用：${expiredLocks.map((lock) => html`<span class="expired-pill" @click=${() => this.selectSegment(lock.segmentId)}>#${segmentOf(lock.segmentId)?.sequence ?? '?'} ${lock.holderName}</span>`)}，任何人可接管</div>` : nothing}
          </div>

          <div class="relay-block">
            <h4>离线发件箱（按发生顺序回放） <em>${orderedChanges.length} 条</em></h4>
            ${orderedChanges.length ? html`
              <ul class="outbox-list">
                ${orderedChanges.map((change) => html`
                  <li>
                    <div class="outbox-head">
                      <cds-tag type=${change.kind === 'confirm' ? 'red' : 'blue'} size="sm">${change.kind === 'confirm' ? '离线确认' : '离线修改'}</cds-tag>
                      <span>#${change.sequence} · ${formatTime(change.createdAt)}</span>
                    </div>
                    <p>${change.corrected}</p>
                    <small>下手版本：片段 v${change.baseRevision} · 术语规则 v${change.baseRulesVersion}</small>
                  </li>`)}
              </ul>
              <div class="relay-actions">
                <cds-button kind="secondary" size="sm" ?disabled=${this.model.connection === 'offline'} @click=${this.replayOutbox}>
                  ${this.model.connection === 'offline' ? '需先恢复连接再回放' : '按顺序回放发件箱'}
                </cds-button>
                <cds-button kind="ghost" size="sm" ?disabled=${this.model.connection !== 'offline'} @click=${this.reconnect}>恢复连接</cds-button>
              </div>
              <small class="relay-hint">回放时已被确认、片段版本过期、术语规则版本变化或正被他人占用的改动不会进直播区，会转入下方冲突队列。</small>
            ` : html`<p class="relay-empty">没有离线暂存改动。</p>`}
          </div>

          <div class="relay-block">
            <h4>冲突复核队列 <em>${openConflicts.length} 条待处理</em></h4>
            ${openConflicts.length ? openConflicts.map((conflict) => {
              const segment = segmentOf(conflict.segmentId);
              return html`
                <article class="conflict-card ${conflict.kind} ${conflict.status === 'loaded-to-editor' ? 'loaded' : ''}">
                  <div class="conflict-head">
                    <cds-tag type=${conflict.kind === 'handoff' ? 'magenta' : conflict.kind === 'confirmed-race' ? 'green' : conflict.kind === 'rules-changed' ? 'purple' : 'warm-gray'} size="sm">#${conflict.index} ${conflictLabel(conflict.kind)}</cds-tag>
                    <span>#${conflict.sequence} · ${formatTime(conflict.occurredAt)}</span>
                  </div>
                  <p class="conflict-reason">${conflict.reason}${conflict.status === 'loaded-to-editor' ? ' · 已载入编辑台，可继续修改后确认' : ''}</p>
                  <div class="conflict-diff">
                    <div class="diff-col incoming">
                      <span>待复核（${conflict.operatorName} · 基于片段 v${conflict.baseRevision} / 规则 v${conflict.baseRulesVersion}）</span>
                      <p>${conflict.incomingText}</p>
                    </div>
                    <div class="diff-col current">
                      <span>直播区现状（片段 v${conflict.currentRevision} / 规则 v${conflict.currentRulesVersion}${conflict.currentConfirmedBy ? ` · ${conflict.currentConfirmedBy} 已确认` : ''}）</span>
                      <p>${conflict.currentText}</p>
                    </div>
                  </div>
                  <div class="conflict-actions">
                    <cds-button kind="primary" size="sm" @click=${() => this.decideConflict(conflict.id, 'take-incoming')}>采用待复核内容</cds-button>
                    <cds-button kind="secondary" size="sm" @click=${() => this.decideConflict(conflict.id, 'keep-current')}>保留现有版本</cds-button>
                    <cds-button kind="ghost" size="sm" @click=${() => this.decideConflict(conflict.id, 'load-to-editor')}>载入编辑台</cds-button>
                    ${segment ? html`<cds-button kind="ghost" size="sm" @click=${() => this.selectSegment(conflict.segmentId)}>跳转片段</cds-button>` : nothing}
                  </div>
                </article>`;
            }) : html`<p class="relay-empty">没有待裁决的冲突。</p>`}
            ${resolvedConflicts.length ? html`<div class="resolved-log">
              <small>最近裁决：</small>
              ${resolvedConflicts.map((conflict) => html`<span class="resolved-pill ${conflict.status}">#${conflict.index} ${conflictLabel(conflict.kind)}：${conflict.status === 'accepted-incoming' ? '采用待复核' : '保留现有'}</span>`)}
            </div>` : nothing}
          </div>

          <div class="relay-block">
            <h4>交接留档 <em>${drafts.length} 份</em></h4>
            ${drafts.length ? html`
              <ul class="draft-list">
                ${drafts.map((draft) => html`
                  <li @click=${() => this.selectSegment(draft.segmentId)}>
                    <div class="draft-head"><b>${draft.fromOperatorName}</b> → <b>${draft.toOperatorName}</b> · #${draft.sequence} · ${formatTime(draft.capturedAt)}</div>
                    <p>${draft.corrected}</p>
                    <small>${draft.reason} · 基于版本 v${draft.baseRevision}</small>
                  </li>`)}
              </ul>` : html`<p class="relay-empty">尚无交接留档；接管过期占用时会自动留存原校对员的内容。</p>`}
          </div>
        </div>
      </section>`;
  }

  private renderInspector() {
    const item = this.selected;
    const confirmed = this.model.segments.filter((segment) => segment.state === 'confirmed').sort((a, b) => a.startTime - b.startTime);
    return html`
      <div class="inspector">
        ${this.renderRelayPanel()}
        <section class="inspector-section">
          <div class="inspector-section-head">
            <h3>术语快捷规则</h3>
            <span>${this.model.rules.filter((rule) => rule.enabled).length} 条启用 · v${this.model.rulesVersion}</span>
          </div>
          <div class="rule-list">
            ${this.model.rules.map((rule) => html`
              <div class="rule-item">
                <div>
                  <strong>${rule.source} → ${rule.replacement}</strong>
                  <p>${rule.speaker || '全部发言人'} · 已使用 ${rule.usageCount} 次</p>
                </div>
                <div class="rule-item-actions">
                  <cds-button kind="ghost" size="sm" @click=${() => this.applyTerm(rule.id)}>应用</cds-button>
                  <cds-button kind="danger--ghost" size="xs" @click=${() => this.deleteRule(rule.id)}>删除</cds-button>
                </div>
              </div>
            `)}
          </div>
          ${this.showRuleForm ? html`
            <div class="rule-form">
              <cds-text-input label-text="原文" .value=${this.ruleSource} @input=${(event: Event) => { this.ruleSource = (event.currentTarget as any).value; }}></cds-text-input>
              <cds-text-input label-text="替换为" .value=${this.ruleReplacement} @input=${(event: Event) => { this.ruleReplacement = (event.currentTarget as any).value; }}></cds-text-input>
              <cds-text-input class="full" label-text="仅对某发言人应用（可空）" .value=${this.ruleSpeaker} @input=${(event: Event) => { this.ruleSpeaker = (event.currentTarget as any).value; }}></cds-text-input>
              <cds-button class="full" size="sm" kind="primary" @click=${this.addRule}>保存规则</cds-button>
            </div>
          ` : html`
            <div style="padding: 10px;"><cds-button kind="tertiary" size="sm" @click=${() => { this.showRuleForm = true; }}>＋ 新增术语规则</cds-button></div>
          `}
        </section>

        <section class="inspector-section">
          <div class="inspector-section-head">
            <h3>直播区时间线</h3>
            <span>${confirmed.length} 段已确认</span>
          </div>
          <div class="live-timeline">
            ${confirmed.length ? confirmed.slice(-12).reverse().map((segment) => html`
              <article class="live-item">
                <time>${formatClock(segment.startTime)} · ${segment.speaker}</time>
                <p>${segment.corrected}</p>
                ${segment.source === 'offline' ? html`<small>离线来源 · 恢复后合并</small>` : nothing}
              </article>
            `) : html`<div class="empty"><strong>直播区等待内容</strong><p>确认一块字幕后，它会从这里进入实时输出。</p></div>`}
          </div>
          ${this.stats.offline > 0 ? html`<div class="delivery-status">离线发件箱有 ${this.stats.offline} 段待合并。恢复连接后按时间顺序提交，不会覆盖已确认内容。</div>` : nothing}
        </section>

        <section class="inspector-section">
          <div class="inspector-section-head">
            <h3>当前片段上下文</h3>
            <span>${item ? `#${item.sequence}` : '未选择'}</span>
          </div>
          <div style="padding: 12px; line-height: 1.5; font-size: 11px;">
            ${item ? html`
              <div><strong>原始字幕：</strong>${item.original}</div>
              <div style="margin-top: 8px;"><strong>修改前校正：</strong>${item.corrected}</div>
              <div style="margin-top: 8px; color: var(--cds-text-secondary);">${item.tags.length ? `标签：${item.tags.join('、')}` : '尚未应用术语标签'}</div>
            ` : html`<span>请选择片段以查看上下文。</span>`}
          </div>
        </section>
      </div>
    `;
  }

  render() {
    const stats = this.stats;
    const backlogRatio = Math.min(100, stats.backlog * 8);
    return html`
      <div class="shell ${this.dark ? 'dark' : ''}" style=${`--caption-font-size: ${this.model.fontSize}px`}>
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">CC</div>
            <div class="brand-copy">
              <strong>LiveCaption Desk</strong>
              <span>${this.model.eventName} · ${this.model.eventDate}</span>
            </div>
          </div>
          <div class="connection-pill ${this.model.connection}">
            <span class="connection-dot"></span>
            <div class="connection-copy">
              <strong>${connectionLabel(this.model.connection)} · ${this.model.simulatedDelay.toFixed(1)} 秒延迟</strong>
              <small>${this.model.connection === 'offline'
                ? `仍可编辑，改动带版本进入离线发件箱（${stats.offline} 条）`
                : `占用 ${stats.activeLocks} 段 · 待复核冲突 ${stats.openConflicts} 条 · 自动保存 ${new Date(this.model.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}</small>
            </div>
          </div>
          <div class="header-actions">
            <label class="operator-switch">
              <span>当前校对员</span>
              <cds-dropdown size="sm" value=${this.operator.id} @cds-dropdown-selected=${(event: CustomEvent<{ item: { value: string } }>) => this.switchOperator(event.detail.item.value)}>
                ${PROOFREADERS.map((op) => html`<cds-dropdown-item value=${op.id}>${op.name} · ${op.role}</cds-dropdown-item>`)}
              </cds-dropdown>
            </label>
            ${stats.openConflicts > 0 ? html`<cds-button kind="danger--tertiary" size="sm" @click=${() => this.renderRoot.querySelector('.relay-section')?.scrollIntoView({ behavior: 'smooth' })}>${stats.openConflicts} 条冲突待复核</cds-button>` : nothing}
            <cds-button kind="ghost" size="sm" @click=${this.toggleTheme}>${this.dark ? '浅色界面' : '深色值守'}</cds-button>
            <cds-button kind="ghost" size="sm" @click=${this.undo}>撤销</cds-button>
            <cds-button kind="ghost" size="sm" @click=${this.redo}>重做</cds-button>
            <cds-button kind="primary" size="sm" @click=${this.exportSrt}>导出 SRT</cds-button>
          </div>
        </header>

        <section class="status-strip">
          <div class="status-cell hero">
            <strong>${this.model.connection === 'offline' ? '离线校正中，改动带版本暂存发件箱' : stats.openConflicts > 0 ? `${stats.openConflicts} 条接力/离线冲突待人工裁决` : stats.backlog > 8 ? '队列积压，建议优先处理过期片段' : '队列节奏正常，可以继续逐段确认'}</strong>
            <span>待确认 ${stats.pending} · 过期 ${stats.stale} · 重复 ${stats.duplicate} · 发件箱 ${stats.offline} · 占用 ${stats.activeLocks} · 冲突 ${stats.openConflicts}</span>
            <div class="queue-track"><span style=${`width:${backlogRatio}%`}></span></div>
          </div>
          <div class="status-cell"><strong>${stats.pending}</strong><span>待确认片段</span></div>
          <div class="status-cell warning"><strong>${stats.oldestWaitSeconds}s</strong><span>最长等待时间</span></div>
          <div class="status-cell danger"><strong>${stats.stale + stats.duplicate + stats.openConflicts}</strong><span>异常与冲突</span></div>
          <div class="status-cell"><strong>${this.model.simulatedDelay.toFixed(1)}s</strong><span>当前流延迟</span></div>
          <div class="font-controls">
            <label>字幕字号</label>
            <cds-button kind="ghost" size="sm" @click=${() => this.adjustFont(-1)}>A−</cds-button>
            <strong>${this.model.fontSize}</strong>
            <cds-button kind="ghost" size="sm" @click=${() => this.adjustFont(1)}>A＋</cds-button>
          </div>
        </section>

        <main class="workspace">
          <section class="column">
            <div class="column-head">
              <div>
                <h2>待确认区</h2>
                <p>按收到顺序排列，重复和过期内容不会被静默覆盖</p>
              </div>
              <cds-dropdown value=${this.filter} @cds-dropdown-selected=${(event: CustomEvent<{ item: { value: string } }>) => { this.filter = event.detail.item.value as typeof this.filter; }}>
                <cds-dropdown-item value="active">仅需处理</cds-dropdown-item>
                <cds-dropdown-item value="attention">异常优先</cds-dropdown-item>
                <cds-dropdown-item value="all">全部片段</cds-dropdown-item>
              </cds-dropdown>
            </div>
            <div class="column-body">${this.renderPendingList()}</div>
          </section>

          <section class="column">
            <div class="column-head">
              <div>
                <h2>校对编辑台</h2>
                <p>标点、专有名词、发言人和数字均可在确认前修改</p>
              </div>
              <cds-tag type="green" size="sm">本地草稿</cds-tag>
            </div>
            <div class="column-body" style=${`font-size:${this.model.fontSize}px`}>${this.renderEditor()}</div>
          </section>

          <section class="column">
            <div class="column-head">
              <div>
                <h2>接力校对 · 规则与直播区</h2>
                <p>占用片段限时交接；离线改动带版本回放，冲突由人裁决</p>
              </div>
              <div class="column-head-actions">
                ${this.model.connection === 'offline'
                  ? html`
                    <cds-button kind="tertiary" size="sm" @click=${this.reconnect}>恢复连接</cds-button>
                    <cds-button kind="primary" size="sm" disabled title="恢复连接后在接力面板按顺序回放">回放发件箱</cds-button>`
                  : html`
                    <cds-button kind="secondary" size="sm" @click=${() => this.setConnection('degraded')}>模拟弱网</cds-button>
                    <cds-button kind="danger--tertiary" size="sm" @click=${() => this.setConnection('offline')}>模拟断线</cds-button>`}
              </div>
            </div>
            <div class="column-body">${this.renderInspector()}</div>
          </section>
        </main>

        <div class="toast-stack">
          ${this.toasts.map((toast) => html`
            <cds-toast-notification
              kind=${toast.kind}
              title=${toast.title}
              subtitle=${toast.subtitle}
              @cds-notification-closed=${() => { this.toasts = this.toasts.filter((item) => item.id !== toast.id); }}
            ></cds-toast-notification>
          `)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'caption-desk': CaptionDesk;
  }
}
