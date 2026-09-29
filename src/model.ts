export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored';
export type SegmentSource = 'live' | 'offline' | 'manual';
export type OfflineChangeKind = 'edit' | 'confirm';
export type ConflictKind = 'handoff' | 'confirmed-race' | 'stale-revision' | 'rules-changed';
export type ConflictStatus = 'open' | 'accepted-current' | 'accepted-incoming' | 'loaded-to-editor';

export interface Proofreader {
  id: string;
  name: string;
  role: string;
  color: string;
}

export interface SegmentLock {
  segmentId: string;
  holderId: string;
  holderName: string;
  acquiredAt: number;
  expiresAt: number;
  renewedAt: number;
  /** 离线期间取得的占用只是本地预占，恢复后才转为正式占用。 */
  provisional?: boolean;
}

export interface HandoffDraft {
  id: string;
  segmentId: string;
  sequence: number;
  fromOperatorId: string;
  fromOperatorName: string;
  toOperatorId: string;
  toOperatorName: string;
  speaker: string;
  corrected: string;
  numberHints: string;
  baseRevision: number;
  capturedAt: number;
  reason: string;
}

export interface OfflineChange {
  id: string;
  segmentId: string;
  sequence: number;
  kind: OfflineChangeKind;
  /** 下手时片段的 revision，用于恢复时判断期间是否被别人改过。 */
  baseRevision: number;
  /** 下手时术语规则的版本。 */
  baseRulesVersion: number;
  createdAt: number;
  speaker: string;
  corrected: string;
  numberHints: string;
  usedRules: string[];
  note: string;
}

export interface ReviewConflict {
  id: string;
  index: number;
  kind: ConflictKind;
  status: ConflictStatus;
  segmentId: string;
  sequence: number;
  occurredAt: number;
  resolvedAt?: number;
  operatorId: string;
  operatorName: string;
  reason: string;
  incomingKind: OfflineChangeKind;
  incomingSpeaker: string;
  incomingText: string;
  baseRevision: number;
  baseRulesVersion: number;
  currentSpeaker: string;
  currentText: string;
  currentRevision: number;
  currentRulesVersion: number;
  currentConfirmedBy: string;
  changeId?: string;
  handoffDraftId?: string;
}

export interface CaptionSegment {
  id: string;
  sequence: number;
  startTime: number;
  receivedAt: number;
  confirmedAt?: number;
  confirmedBy?: string;
  speaker: string;
  original: string;
  corrected: string;
  numberHints: string;
  source: SegmentSource;
  state: SegmentState;
  duplicateOf?: string;
  staleReason?: string;
  revision: number;
  tags: string[];
}

export interface TermRule {
  id: string;
  source: string;
  replacement: string;
  speaker: string;
  enabled: boolean;
  caseSensitive: boolean;
  usageCount: number;
  createdAt: number;
}

export interface DeskModel {
  eventName: string;
  eventDate: string;
  segments: CaptionSegment[];
  rules: TermRule[];
  /** 术语规则的全局版本，任何增删改都会递增；离线改动以此判断规则是否已变化。 */
  rulesVersion: number;
  selectedId: string;
  connection: ConnectionState;
  simulatedDelay: number;
  fontSize: number;
  nextSequence: number;
  autoStream: boolean;
  currentOperatorId: string;
  locks: SegmentLock[];
  handoffDrafts: HandoffDraft[];
  offlineChanges: OfflineChange[];
  conflicts: ReviewConflict[];
  nextConflictIndex: number;
  lastMergedAt?: number;
  updatedAt: number;
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

export const LOCK_TTL_MS = 30_000;

export const PROOFREADERS: Proofreader[] = [
  { id: 'op-zhou', name: '周恺', role: '主班校对', color: '#0f62fe' },
  { id: 'op-lin', name: '林越', role: '接班校对', color: '#007d79' },
  { id: 'op-yan', name: '严晓', role: '备班校对', color: '#8a3ffc' },
];

export function proofreaderById(id: string): Proofreader {
  return PROOFREADERS.find((item) => item.id === id) ?? PROOFREADERS[0];
}

const now = Date.now();
export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v1';

function segment(
  id: string,
  sequence: number,
  startTime: number,
  speaker: string,
  original: string,
  corrected = original,
  state: SegmentState = 'pending',
): CaptionSegment {
  return {
    id,
    sequence,
    startTime,
    receivedAt: now - (100 - sequence) * 8_000,
    confirmedAt: state === 'confirmed' ? now - (100 - sequence) * 7_000 : undefined,
    speaker,
    original,
    corrected,
    numberHints: '',
    source: 'live',
    state,
    revision: 0,
    tags: [],
  };
}

const seededSegments: CaptionSegment[] = [
  segment('seg-1', 1, 0, '主持人', '欢迎大家来到二零二六年产品发布会。', '欢迎大家来到2026年产品发布会。', 'confirmed'),
  segment('seg-2', 2, 7, '主讲人', '今天我们会介绍三个模块,首先是实时协作。', '今天我们会介绍三个模块，首先是实时协作。', 'confirmed'),
  segment('seg-3', 3, 15, '主讲人', '延迟和质量监测会帮助我们保持字幕稳定。', '延迟和质量监测会帮助我们保持字幕稳定。', 'confirmed'),
  segment('seg-4', 4, 24, '嘉宾 / 周然', '我们使用 studio cloud 作为演示环境。', '我们使用 Studio Cloud 作为演示环境。', 'pending'),
  segment('seg-5', 5, 34, '嘉宾 / 周然', '每分钟大约会收到一百二十个片段。', '每分钟大约会收到120个片段。', 'pending'),
  segment('seg-6', 6, 43, '主持人', '如果主持人提到 co pilot,需要统一大小写。', '如果主持人提到 Co-Pilot，需要统一大小写。', 'pending'),
  segment('seg-7', 7, 52, '主持人', '这个例子会演示五G网络下的字幕恢复。', '这个例子会演示5G网络下的字幕恢复。', 'pending'),
];

const duplicate: CaptionSegment = {
  ...segment('seg-8', 8, 61, '主讲人', '今天我们重点讨论字幕队列。', '今天我们重点讨论字幕队列。', 'duplicate'),
  source: 'live',
  duplicateOf: 'seg-2',
  staleReason: '与第 2 段高度相似',
};

export function createInitialModel(): DeskModel {
  const seedTime = Date.now();
  return {
    eventName: '新品发布会现场字幕',
    eventDate: new Date(now).toISOString().slice(0, 10),
    segments: [...seededSegments, duplicate],
    rules: [
      { id: 'term-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 4, createdAt: now - 86_400_000 },
      { id: 'term-2', source: 'studio cloud', replacement: 'Studio Cloud', speaker: '', enabled: true, caseSensitive: false, usageCount: 7, createdAt: now - 43_200_000 },
      { id: 'term-3', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 2, createdAt: now - 3_600_000 },
    ],
    rulesVersion: 1,
    selectedId: 'seg-4',
    connection: 'connected',
    simulatedDelay: 1.8,
    fontSize: 18,
    nextSequence: 9,
    autoStream: true,
    currentOperatorId: 'op-lin',
    locks: [
      {
        segmentId: 'seg-6',
        holderId: 'op-zhou',
        holderName: '周恺',
        acquiredAt: seedTime - (LOCK_TTL_MS - 14_000),
        expiresAt: seedTime + 14_000,
        renewedAt: seedTime - (LOCK_TTL_MS - 14_000),
      },
    ],
    handoffDrafts: [],
    offlineChanges: [],
    conflicts: [],
    nextConflictIndex: 1,
    updatedAt: now,
  };
}

/** 为缺少接力校对字段的旧版本草稿补齐默认值。 */
export function hydrateModel(parsed: DeskModel): DeskModel {
  return {
    ...parsed,
    rulesVersion: parsed.rulesVersion ?? 1,
    currentOperatorId: parsed.currentOperatorId && PROOFREADERS.some((item) => item.id === parsed.currentOperatorId)
      ? parsed.currentOperatorId
      : PROOFREADERS[0].id,
    locks: parsed.locks ?? [],
    handoffDrafts: parsed.handoffDrafts ?? [],
    offlineChanges: parsed.offlineChanges ?? [],
    conflicts: parsed.conflicts ?? [],
    nextConflictIndex: parsed.nextConflictIndex ?? (parsed.conflicts?.length ?? 0) + 1,
    segments: (parsed.segments ?? []).map((item) => ({ ...item })),
    rules: (parsed.rules ?? []).map((item) => ({ ...item })),
  };
}

export function cloneModel(model: DeskModel): DeskModel {
  return structuredClone(model);
}

export function normalizeNumbers(text: string): string {
  const digitMap: Record<string, string> = { '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9' };
  const chineseNumber = (raw: string): number => {
    const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!/[十百千万]/u.test(raw)) return Number([...raw].map((char) => digits[char] ?? 0).join(''));
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of raw) {
      if (digits[char] !== undefined) {
        number = digits[char];
      } else if (char === '十') {
        section += (number || 1) * 10;
        number = 0;
      } else if (char === '百') {
        section += (number || 1) * 100;
        number = 0;
      } else if (char === '千') {
        section += (number || 1) * 1000;
        number = 0;
      } else if (char === '万') {
        total += (section + number) * 10_000;
        section = 0;
        number = 0;
      }
    }
    return total + section + number;
  };

  return text
    .replace(/[０-９]/g, (char) => digitMap[char] ?? char)
    .replace(/([零〇一二两三四五六七八九十百千万]+)/gu, (match) => String(chineseNumber(match)))
    .replace(/(?<=\d)[，,](?=\d{3}\b)/g, ',');
}

export function normalizePunctuation(text: string): string {
  return text
    .replace(/([，。！？；：])(?=[^\s，。！？；：])/gu, '$1')
    .replace(/\s+([，。！？；：])/gu, '$1')
    .replace(/([,;:!?])(?=[^\s,;:!?])/g, (match) => ({ ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' }[match] ?? match));
}

export function applyRules(text: string, model: DeskModel): { text: string; used: string[] } {
  let next = text;
  const used: string[] = [];
  for (const rule of model.rules.filter((item) => item.enabled)) {
    if (!rule.source || !next) continue;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    const expression = new RegExp(rule.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    if (expression.test(next)) {
      next = next.replace(expression, rule.replacement);
      used.push(rule.id);
    }
  }
  return { text: normalizePunctuation(next), used };
}

export function isDuplicate(candidate: CaptionSegment, existing: CaptionSegment[]): CaptionSegment | undefined {
  const normalize = (value: string) => value.replace(/[\s，。！？；：,.;:!?]/g, '').toLocaleLowerCase();
  const candidateText = normalize(candidate.corrected || candidate.original);
  return existing.find((segmentItem) => {
    if (segmentItem.id === candidate.id || segmentItem.state === 'ignored') return false;
    const text = normalize(segmentItem.corrected || segmentItem.original);
    if (!candidateText || !text) return false;
    return text === candidateText || (Math.abs(segmentItem.startTime - candidate.startTime) < 12 && (text.includes(candidateText) || candidateText.includes(text)));
  });
}

// ---------------------------------------------------------------------------
// 接力校对：片段占用锁
// ---------------------------------------------------------------------------

export function isLockActive(lock: SegmentLock | undefined, at = Date.now()): boolean {
  // 「占用有效」只看过期时间；离线预占（provisional）是否生效由调用方结合连接状态判断。
  return !!lock && lock.expiresAt > at;
}

export function getLock(model: DeskModel, segmentId: string): SegmentLock | undefined {
  return model.locks.find((lock) => lock.segmentId === segmentId);
}

export type AcquireOutcome =
  | { ok: true; model: DeskModel; action: 'acquired' | 'renewed' | 'taken-over'; draft?: HandoffDraft }
  | { ok: false; reason: 'held-by-other' | 'expired-other'; lock: SegmentLock };

/**
 * 校对员占用片段：
 * - 无人占用 → 取得占用（离线时只是本地预占，恢复连接后不能自动转正）；
 * - 自己占用中 → 续期；
 * - 别人正在占用 → 拒绝；
 * - 别人的占用已过期 → 接管，并把对方手头的内容快照成交接留档。
 */
export function acquireSegmentLock(
  model: DeskModel,
  segmentId: string,
  operator: Proofreader,
  options: { provisional?: boolean; ttl?: number; now?: number } = {},
): AcquireOutcome {
  const at = options.now ?? Date.now();
  const ttl = options.ttl ?? LOCK_TTL_MS;
  const segment = model.segments.find((item) => item.id === segmentId);
  if (!segment) return { ok: false, reason: 'held-by-other', lock: undefined as unknown as SegmentLock };
  const existing = getLock(model, segmentId);

  if (existing && existing.holderId === operator.id) {
    const renewed: SegmentLock = { ...existing, expiresAt: at + ttl, renewedAt: at, provisional: options.provisional ? true : existing.provisional };
    return {
      ok: true,
      action: 'renewed',
      model: { ...model, locks: model.locks.map((lock) => lock.segmentId === segmentId ? renewed : lock), updatedAt: at },
    };
  }

  if (existing && existing.holderId !== operator.id && existing.expiresAt > at && !(options.provisional && existing.provisional)) {
    return { ok: false, reason: 'held-by-other', lock: existing };
  }

  let draft: HandoffDraft | undefined;
  if (existing && existing.holderId !== operator.id) {
    draft = {
      id: `handoff-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      segmentId,
      sequence: segment.sequence,
      fromOperatorId: existing.holderId,
      fromOperatorName: existing.holderName,
      toOperatorId: operator.id,
      toOperatorName: operator.name,
      speaker: segment.speaker,
      corrected: segment.corrected,
      numberHints: segment.numberHints,
      baseRevision: segment.revision,
      capturedAt: at,
      reason: `原占用已于 ${new Date(existing.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 过期`,
    };
  }

  const lock: SegmentLock = {
    segmentId,
    holderId: operator.id,
    holderName: operator.name,
    acquiredAt: at,
    expiresAt: at + ttl,
    renewedAt: at,
    provisional: options.provisional === true || undefined,
  };
  const locks = existing ? model.locks.map((item) => item.segmentId === segmentId ? lock : item) : [...model.locks, lock];
  return {
    ok: true,
    action: existing ? 'taken-over' : 'acquired',
    draft,
    model: {
      ...model,
      locks,
      handoffDrafts: draft ? [...model.handoffDrafts, draft] : model.handoffDrafts,
      updatedAt: at,
    },
  };
}

export function releaseLock(model: DeskModel, segmentId: string, operatorId?: string): DeskModel {
  return {
    ...model,
    locks: model.locks.filter((lock) => lock.segmentId !== segmentId || (operatorId !== undefined && lock.holderId !== operatorId)),
    updatedAt: Date.now(),
  };
}

export function renewLock(model: DeskModel, segmentId: string, operatorId: string, ttl = LOCK_TTL_MS, at = Date.now()): DeskModel {
  return {
    ...model,
    locks: model.locks.map((lock) => lock.segmentId === segmentId && lock.holderId === operatorId
      ? { ...lock, expiresAt: at + ttl, renewedAt: at }
      : lock),
    updatedAt: at,
  };
}

// ---------------------------------------------------------------------------
// 冲突登记
// ---------------------------------------------------------------------------

export function addConflict(
  model: DeskModel,
  args: {
    kind: ConflictKind;
    segment: CaptionSegment;
    operator: Proofreader;
    reason: string;
    change?: OfflineChange;
    draft?: HandoffDraft;
    incomingSpeaker?: string;
    incomingText?: string;
    incomingKind?: OfflineChangeKind;
  },
): { model: DeskModel; conflict: ReviewConflict } {
  const at = Date.now();
  const conflict: ReviewConflict = {
    id: `conflict-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    index: model.nextConflictIndex,
    kind: args.kind,
    status: 'open',
    segmentId: args.segment.id,
    sequence: args.segment.sequence,
    occurredAt: at,
    operatorId: args.operator.id,
    operatorName: args.operator.name,
    reason: args.reason,
    incomingKind: args.incomingKind ?? args.change?.kind ?? 'edit',
    incomingSpeaker: args.incomingSpeaker ?? args.change?.speaker ?? args.draft?.speaker ?? args.segment.speaker,
    incomingText: args.incomingText ?? args.change?.corrected ?? args.draft?.corrected ?? args.segment.corrected,
    baseRevision: args.change?.baseRevision ?? args.draft?.baseRevision ?? args.segment.revision,
    baseRulesVersion: args.change?.baseRulesVersion ?? model.rulesVersion,
    currentSpeaker: args.segment.speaker,
    currentText: args.segment.corrected,
    currentRevision: args.segment.revision,
    currentRulesVersion: model.rulesVersion,
    currentConfirmedBy: args.segment.confirmedBy ?? '',
    changeId: args.change?.id,
    handoffDraftId: args.draft?.id,
  };
  return {
    conflict,
    model: { ...model, conflicts: [...model.conflicts, conflict], nextConflictIndex: model.nextConflictIndex + 1, updatedAt: at },
  };
}

// ---------------------------------------------------------------------------
// 离线发件箱：改动带着下手时的版本排队
// ---------------------------------------------------------------------------

export function queueOfflineChange(
  model: DeskModel,
  args: {
    segment: CaptionSegment;
    kind: OfflineChangeKind;
    speaker: string;
    corrected: string;
    numberHints?: string;
    usedRules?: string[];
    note?: string;
  },
): DeskModel {
  const at = Date.now();
  const existing = model.offlineChanges.find((change) => change.segmentId === args.segment.id);
  if (existing) {
    // 同一离线窗口内对同一片段的连续修改合并成一条，保留下手瞬间的版本与最早时间。
    const merged: OfflineChange = {
      ...existing,
      kind: args.kind === 'confirm' ? 'confirm' : existing.kind,
      speaker: args.speaker,
      corrected: args.corrected,
      numberHints: args.numberHints ?? existing.numberHints,
      usedRules: args.usedRules ?? existing.usedRules,
      note: args.note ?? existing.note,
    };
    return { ...model, offlineChanges: model.offlineChanges.map((change) => change.id === existing.id ? merged : change), updatedAt: at };
  }
  const change: OfflineChange = {
    id: `offline-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    segmentId: args.segment.id,
    sequence: args.segment.sequence,
    kind: args.kind,
    baseRevision: args.segment.revision,
    baseRulesVersion: model.rulesVersion,
    createdAt: at,
    speaker: args.speaker,
    corrected: args.corrected,
    numberHints: args.numberHints ?? args.segment.numberHints,
    usedRules: args.usedRules ?? [],
    note: args.note ?? '',
  };
  return { ...model, offlineChanges: [...model.offlineChanges, change], updatedAt: at };
}

/**
 * 恢复连接后按发生顺序回放离线发件箱。
 * 以下旧改动不会直接进直播区，而是按顺序登记到冲突队列：
 * 1. 片段已被别人确认；2. 术语规则版本已变化（针对确认类改动）；
 * 3. 下手后片段又被别人改过（revision 不一致）；4. 片段正被别人正式占用。
 */
export function replayOfflineChanges(model: DeskModel): DeskModel {
  const at = Date.now();
  const ordered = [...model.offlineChanges].sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence);
  const segments = model.segments.map((item) => ({ ...item }));
  let rulesVersion = model.rulesVersion;
  let nextConflictIndex = model.nextConflictIndex;
  const conflicts = [...model.conflicts];
  const consumed = new Set<string>();
  let applied = 0;

  for (const change of ordered) {
    const segment = segments.find((item) => item.id === change.segmentId);
    if (!segment) {
      consumed.add(change.id);
      continue;
    }
    const operator = proofreaderById(model.currentOperatorId);
    const activeLock = model.locks.find((lock) => lock.segmentId === segment.id && !lock.provisional && lock.holderId !== operator.id && lock.expiresAt > at);

    let kind: ConflictKind | undefined;
    let reason = '';
    if (segment.state === 'confirmed' && segment.confirmedBy !== operator.name) {
      kind = 'confirmed-race';
      reason = `该片段已于离线期间由 ${segment.confirmedBy || '其他校对员'} 确认进入直播区`;
    } else if (change.kind === 'confirm' && change.baseRulesVersion !== rulesVersion) {
      kind = 'rules-changed';
      reason = `下手时术语规则为 v${change.baseRulesVersion}，当前为 v${rulesVersion}，旧确认不能直接进直播区`;
    } else if (segment.revision !== change.baseRevision) {
      kind = 'stale-revision';
      reason = `下手时基于修改版本 v${change.baseRevision}，片段已被别人改到 v${segment.revision}`;
    } else if (activeLock) {
      kind = 'handoff';
      reason = `片段正由 ${activeLock.holderName} 占用（至 ${new Date(activeLock.expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`;
    }

    if (kind) {
      conflicts.push({
        id: `conflict-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        index: nextConflictIndex++,
        kind,
        status: 'open',
        segmentId: segment.id,
        sequence: segment.sequence,
        occurredAt: at,
        operatorId: operator.id,
        operatorName: operator.name,
        reason,
        incomingKind: change.kind,
        incomingSpeaker: change.speaker,
        incomingText: change.corrected,
        baseRevision: change.baseRevision,
        baseRulesVersion: change.baseRulesVersion,
        currentSpeaker: segment.speaker,
        currentText: segment.corrected,
        currentRevision: segment.revision,
        currentRulesVersion: rulesVersion,
        currentConfirmedBy: segment.confirmedBy ?? '',
        changeId: change.id,
      });
      continue;
    }

    segment.speaker = change.speaker;
    segment.corrected = change.corrected;
    segment.numberHints = change.numberHints || segment.numberHints;
    segment.revision += 1;
    if (change.kind === 'confirm') {
      segment.state = 'confirmed';
      segment.source = 'offline';
      segment.confirmedAt = change.createdAt;
      segment.confirmedBy = operator.name;
      segment.duplicateOf = undefined;
      segment.tags = [...new Set([...segment.tags, '术语已应用', '离线恢复合并'])];
      if (at - change.createdAt > 90_000) {
        segment.state = 'stale';
        segment.staleReason = `离线恢复后合并，原始改动已延迟 ${Math.round((at - change.createdAt) / 1000)} 秒`;
      }
    }
    consumed.add(change.id);
    applied += 1;
  }

  // 重复片段复检（与历史合并逻辑一致），只影响仍在待确认区的片段。
  const seen: CaptionSegment[] = [];
  for (const item of segments.sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime)) {
    if (item.state === 'ignored') continue;
    const duplicate = isDuplicate(item, seen);
    if (duplicate && item.state !== 'confirmed' && item.state !== 'stale') {
      item.state = 'duplicate';
      item.duplicateOf = duplicate.id;
      item.staleReason = item.staleReason ?? `与第 ${duplicate.sequence} 段高度相似`;
    }
    seen.push(item);
  }

  // 离线期间的本地预占一律失效；过期占用同样视为已释放（仍可在交接留档回溯）。
  // 冲突片段复核时由接手校对员重新占用。
  const locks = model.locks.filter((lock) => !lock.provisional && lock.expiresAt > at);

  return {
    ...model,
    segments,
    locks,
    rulesVersion,
    conflicts: conflicts.sort((a, b) => a.occurredAt - b.occurredAt || a.index - b.index),
    nextConflictIndex,
    offlineChanges: model.offlineChanges.filter((change) => !consumed.has(change.id)),
    connection: 'connected',
    simulatedDelay: Math.max(0.8, model.simulatedDelay - 0.7),
    lastMergedAt: at,
    updatedAt: at,
  };
}

export function bumpRulesVersion(model: DeskModel): DeskModel {
  return { ...model, rulesVersion: model.rulesVersion + 1, updatedAt: Date.now() };
}

export type ConflictDecision = 'keep-current' | 'take-incoming' | 'load-to-editor';

/** 人工裁决一条冲突：保留现有版本 / 采用待复核内容 / 载入编辑台继续处理。 */
export function resolveConflict(model: DeskModel, conflictId: string, decision: ConflictDecision, operator: Proofreader): DeskModel {
  const at = Date.now();
  const conflict = model.conflicts.find((item) => item.id === conflictId);
  if (!conflict || (conflict.status !== 'open' && conflict.status !== 'loaded-to-editor')) return model;
  const segment = model.segments.find((item) => item.id === conflict.segmentId);

  if (decision === 'load-to-editor') {
    return {
      ...model,
      selectedId: conflict.segmentId,
      conflicts: model.conflicts.map((item) => item.id === conflictId ? { ...item, status: 'loaded-to-editor' } : item),
      updatedAt: at,
    };
  }

  let segments = model.segments;
  if (decision === 'take-incoming' && segment) {
    segments = model.segments.map((item) => {
      if (item.id !== conflict.segmentId) return item;
      const next: CaptionSegment = {
        ...item,
        speaker: conflict.incomingSpeaker,
        corrected: conflict.incomingText,
        revision: item.revision + 1,
        tags: [...new Set([...item.tags, '接力复核采用'])],
      };
      if (conflict.incomingKind === 'confirm') {
        next.state = 'confirmed';
        next.source = 'live';
        next.confirmedAt = at;
        next.confirmedBy = operator.name;
        next.staleReason = undefined;
        next.duplicateOf = undefined;
      }
      return next;
    });
  }

  const status: ConflictStatus = decision === 'take-incoming' ? 'accepted-incoming' : 'accepted-current';
  return {
    ...model,
    segments,
    selectedId: decision === 'take-incoming' ? conflict.segmentId : model.selectedId,
    locks: decision === 'take-incoming' ? model.locks.filter((lock) => lock.segmentId !== conflict.segmentId) : model.locks,
    offlineChanges: model.offlineChanges.filter((change) => change.id !== conflict.changeId),
    conflicts: model.conflicts.map((item) => item.id === conflictId ? { ...item, status, resolvedAt: at } : item),
    updatedAt: at,
  };
}

export function conflictLabel(kind: ConflictKind): string {
  return {
    handoff: '交接冲突',
    'confirmed-race': '已被确认',
    'stale-revision': '版本过期',
    'rules-changed': '术语版本变化',
  }[kind];
}

export function mergeConfirmedSegments(model: DeskModel): DeskModel {
  return replayOfflineChanges(model);
}

export function queueStats(model: DeskModel, at = Date.now()) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const offline = model.offlineChanges.length;
  const openConflicts = model.conflicts.filter((item) => item.status === 'open' || item.status === 'loaded-to-editor').length;
  const activeLocks = model.locks.filter((lock) => !lock.provisional && lock.expiresAt > at).length;
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    offline,
    openConflicts,
    activeLocks,
    backlog: pending.length + stale.length + duplicate.length + offline + openConflicts,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.round((Date.now() - item.receivedAt) / 1000))) : 0,
  };
}

export function createLiveSegment(sequence: number): CaptionSegment {
  const speakers = ['主持人', '主讲人', '嘉宾 / 周然', '现场提问'];
  const samples = [
    '接下来请产品团队介绍新的工作流。',
    '请注意屏幕右侧的实时队列状态。',
    '在弱网环境下我们会保留未确认片段。',
    '如果网络恢复,系统会按照时间顺序自动合并。',
    '这段字幕包含二零二五年的项目数据。',
    '大家可以在会后查看完整回放和术语表。',
  ];
  const start = Math.max(0, sequence * 9 - 10);
  return {
    id: `seg-live-${sequence}-${Date.now().toString(36)}`,
    sequence,
    startTime: start,
    receivedAt: Date.now(),
    speaker: speakers[(sequence - 1) % speakers.length],
    original: samples[(sequence - 1) % samples.length],
    corrected: samples[(sequence - 1) % samples.length],
    numberHints: '',
    source: 'live',
    state: 'pending',
    revision: 0,
    tags: [],
  };
}

export function simulateLatency(model: DeskModel): DeskModel {
  if (model.connection === 'offline') return model;
  const step = model.connection === 'degraded' ? 0.7 : model.simulatedDelay > 2.8 ? -0.3 : 0.15;
  const delay = Math.max(0.7, Math.min(8.9, Number((model.simulatedDelay + step).toFixed(1))));
  const applyStream = model.autoStream && Math.random() > 0.68;
  let nextSequence = model.nextSequence;
  let segments = model.segments;
  if (applyStream) {
    const candidate = createLiveSegment(model.nextSequence);
    const duplicate = isDuplicate(candidate, segments);
    segments = [...segments, duplicate ? { ...candidate, state: 'duplicate', duplicateOf: duplicate.id, staleReason: `与第 ${duplicate.sequence} 段重复` } : candidate];
    nextSequence += 1;
  }
  const pendingCutoff = Date.now() - 90_000;
  segments = segments.map((item) => item.state === 'pending' && item.receivedAt < pendingCutoff
    ? { ...item, state: 'stale', staleReason: `片段已等待 ${Math.round((Date.now() - item.receivedAt) / 1000)} 秒` }
    : item);
  return {
    ...model,
    segments,
    nextSequence,
    simulatedDelay: delay,
    connection: delay > 4.2 ? 'degraded' : model.connection,
    updatedAt: Date.now(),
  };
}

export function toSrt(model: DeskModel): string {
  const stamp = (seconds: number, separator = ',') => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds - Math.floor(seconds)) * 1000);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
  };
  return model.segments
    .filter((item) => item.state === 'confirmed')
    .sort((a, b) => a.startTime - b.startTime)
    .map((item, index) => `${index + 1}\n${stamp(item.startTime)} --> ${stamp(item.startTime + 7)}\n[${item.speaker}] ${item.corrected}\n`)
    .join('\n');
}
