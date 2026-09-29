export type ConnectionState = 'connected' | 'degraded' | 'offline';
export type SegmentState = 'pending' | 'confirmed' | 'duplicate' | 'stale' | 'ignored' | 'review';
export type SegmentSource = 'live' | 'offline' | 'manual';

export interface RelayOperator {
  id: string;
  name: string;
}

export const OPERATORS: RelayOperator[] = [
  { id: 'op-a', name: '校对员 A（林晓）' },
  { id: 'op-b', name: '校对员 B（周驰）' },
  { id: 'op-c', name: '校对员 C（夜班接班）' },
];

/** 单次接力占用：谁、第几任、何时到期、下手时所依据的版本。 */
export interface SegmentLock {
  holderId: string;
  holderName: string;
  epoch: number;
  acquiredAt: number;
  expiresAt: number;
  ttlMs: number;
  baseRevision: number;
  baseRulesVersion: number;
}

/** 被接管时为原处理人留存的稿件，恢复后用于交接冲突复核。 */
export interface HandoffDraft {
  operatorId: string;
  operatorName: string;
  epoch: number;
  speaker: string;
  text: string;
  savedAt: number;
}

export type ReviewKind = 'handoff' | 'remote-confirmed' | 'rules-changed';
export type ReviewDecision =
  | 'apply-draft'
  | 'keep-current'
  | 'discard'
  | 'replay'
  | 'keep-live'
  | 'recheck';

export interface PendingReview {
  id: string;
  segmentId: string;
  sequence: number;
  kind: ReviewKind;
  /** 提交方（离线恢复者 / 被接管的原处理人）带来的版本。 */
  draftSpeaker: string;
  draftText: string;
  draftRevision: number;
  draftRulesVersion: number;
  submittedAt: number;
  submittedById: string;
  submittedByName: string;
  /** 直播区当前版本（已被他人确认，或对应现行术语规则）。 */
  liveSpeaker: string;
  liveText: string;
  liveRulesVersion: number;
  confirmedByName?: string;
  reason: string;
}

export interface RemoteConfirm {
  segmentId: string;
  byName: string;
  at: number;
}

export type RelayLogKind = 'lock' | 'release' | 'takeover' | 'remote' | 'rules' | 'review' | 'reconcile';

export interface RelayEvent {
  id: string;
  at: number;
  kind: RelayLogKind;
  text: string;
}

export interface CaptionSegment {
  id: string;
  sequence: number;
  startTime: number;
  receivedAt: number;
  confirmedAt?: number;
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
  /** 当前接力占用（过期后仍保留记录，直到被接管或释放）。 */
  lock?: SegmentLock;
  /** 最近一次接管时为原处理人留存的稿件。 */
  handoff?: HandoffDraft;
  confirmedBy?: string;
  /** 离线确认时携带的下手版本信息，恢复合并时用于冲突判定。 */
  offlineBaseRevision?: number;
  offlineBaseRulesVersion?: number;
  offlineDraftSpeaker?: string;
  offlineDraftText?: string;
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
  selectedId: string;
  connection: ConnectionState;
  simulatedDelay: number;
  fontSize: number;
  nextSequence: number;
  autoStream: boolean;
  lastMergedAt?: number;
  updatedAt: number;
  currentOperatorId: string;
  rulesVersion: number;
  reviews: PendingReview[];
  remoteConfirms: RemoteConfirm[];
  relayLog: RelayEvent[];
}

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  subtitle: string;
}

const now = Date.now();
export const STORAGE_KEY = 'sologsb-1011-live-caption-desk-v1';
/** 单次占用时限：每次编辑滑动续期；超时后其他校对员可接管。 */
export const LOCK_TTL_MS = 45_000;

let logCounter = 0;
export function relayEvent(kind: RelayLogKind, text: string, at = Date.now()): RelayEvent {
  logCounter += 1;
  return { id: `relay-${at.toString(36)}-${logCounter}`, at, kind, text };
}

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

/** 预置一个同事的占用，交班场景一进页面就能看到。 */
const occupiedByColleague: CaptionSegment = {
  ...seededSegments[4],
  lock: {
    holderId: 'op-b',
    holderName: '校对员 B（周驰）',
    epoch: 1,
    acquiredAt: now - 8_000,
    expiresAt: now + 37_000,
    ttlMs: LOCK_TTL_MS,
    baseRevision: seededSegments[4].revision,
    baseRulesVersion: 1,
  },
};

export function createInitialModel(): DeskModel {
  const seeded: CaptionSegment[] = [
    ...seededSegments.slice(0, 4),
    occupiedByColleague,
    ...seededSegments.slice(5),
    duplicate,
  ];
  return {
    eventName: '新品发布会现场字幕',
    eventDate: new Date(now).toISOString().slice(0, 10),
    segments: seeded,
    rules: [
      { id: 'term-1', source: 'co pilot', replacement: 'Co-Pilot', speaker: '', enabled: true, caseSensitive: false, usageCount: 4, createdAt: now - 86_400_000 },
      { id: 'term-2', source: 'studio cloud', replacement: 'Studio Cloud', speaker: '', enabled: true, caseSensitive: false, usageCount: 7, createdAt: now - 43_200_000 },
      { id: 'term-3', source: '五G', replacement: '5G', speaker: '', enabled: true, caseSensitive: true, usageCount: 2, createdAt: now - 3_600_000 },
    ],
    selectedId: 'seg-4',
    connection: 'connected',
    simulatedDelay: 1.8,
    fontSize: 18,
    nextSequence: 9,
    autoStream: true,
    updatedAt: now,
    currentOperatorId: 'op-a',
    rulesVersion: 1,
    reviews: [],
    remoteConfirms: [],
    relayLog: [
      relayEvent('lock', '校对员 B（周驰）开始处理第 5 段，占用 45 秒', now - 8_000),
    ],
  };
}

/** 合并旧版本 localStorage 草稿里缺失的接力字段。 */
export function migrateModel(parsed: Partial<DeskModel>): DeskModel {
  const base = createInitialModel();
  return {
    ...base,
    ...parsed,
    segments: parsed.segments?.length ? parsed.segments : base.segments,
    rules: parsed.rules ?? base.rules,
    reviews: parsed.reviews ?? [],
    remoteConfirms: parsed.remoteConfirms ?? [],
    relayLog: parsed.relayLog ?? [],
    currentOperatorId: parsed.currentOperatorId ?? base.currentOperatorId,
    rulesVersion: parsed.rulesVersion ?? base.rulesVersion,
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
// 接力校对：占用 / 接管 / 交接冲突
// ---------------------------------------------------------------------------

export type LockStatus = 'none' | 'mine' | 'locked' | 'expired';

export function lockStatus(segment: CaptionSegment, operatorId: string, at = Date.now()): LockStatus {
  const lock = segment.lock;
  if (!lock) return 'none';
  if (lock.holderId === operatorId) return 'mine';
  return at < lock.expiresAt ? 'locked' : 'expired';
}

export interface ActiveLockEntry {
  segment: CaptionSegment;
  lock: SegmentLock;
  status: LockStatus;
  remainingMs: number;
}

export function activeLocks(model: DeskModel, at = Date.now()): ActiveLockEntry[] {
  const entries: ActiveLockEntry[] = [];
  for (const segmentItem of model.segments) {
    if (!segmentItem.lock) continue;
    const status = lockStatus(segmentItem, model.currentOperatorId, at);
    entries.push({
      segment: segmentItem,
      lock: segmentItem.lock,
      status,
      remainingMs: segmentItem.lock.expiresAt - at,
    });
  }
  return entries.sort((a, b) => a.lock.expiresAt - b.lock.expiresAt);
}

function editableStates(): SegmentState[] {
  return ['pending', 'stale', 'duplicate', 'review'];
}

/** 开始处理或滑动续期；只有当前持有人能续期，抢占必须走接管流程。 */
export function touchLock(model: DeskModel, segmentId: string, operator: RelayOperator, at = Date.now()): DeskModel {
  const current = model.segments.find((item) => item.id === segmentId);
  if (!current) return model;
  const renewed = current.lock?.holderId === operator.id;
  const nextSegments = model.segments.map((item) => {
    if (item.id !== segmentId) return item;
    const existing = item.lock;
    if (existing && existing.holderId === operator.id) {
      return { ...item, lock: { ...existing, expiresAt: at + existing.ttlMs } };
    }
    return {
      ...item,
      lock: {
        holderId: operator.id,
        holderName: operator.name,
        epoch: (existing?.epoch ?? 0) + 1,
        acquiredAt: at,
        expiresAt: at + LOCK_TTL_MS,
        ttlMs: LOCK_TTL_MS,
        baseRevision: item.revision,
        baseRulesVersion: model.rulesVersion,
      },
    };
  });
  if (renewed) return { ...model, segments: nextSegments, updatedAt: at };
  return {
    ...model,
    segments: nextSegments,
    updatedAt: at,
    relayLog: [...model.relayLog, relayEvent('lock', `${operator.name} 开始处理第 ${current.sequence} 段，占用 ${Math.round(LOCK_TTL_MS / 1000)} 秒`, at)].slice(-30),
  };
}

/** 过期后接管：为原处理人留存当前稿件，任数 +1，旧锁上的提交会被识别为交接冲突。 */
export function takeoverSegment(model: DeskModel, segmentId: string, operator: RelayOperator, at = Date.now()): DeskModel {
  const target = model.segments.find((item) => item.id === segmentId);
  if (!target || !target.lock || target.lock.holderId === operator.id) return model;
  const previous = target.lock;
  const preserveDraft = editableStates().includes(target.state)
    ? {
        operatorId: previous.holderId,
        operatorName: previous.holderName,
        epoch: previous.epoch,
        speaker: target.speaker,
        text: target.corrected,
        savedAt: at,
      }
    : target.handoff;
  const lock: SegmentLock = {
    holderId: operator.id,
    holderName: operator.name,
    epoch: previous.epoch + 1,
    acquiredAt: at,
    expiresAt: at + LOCK_TTL_MS,
    ttlMs: LOCK_TTL_MS,
    baseRevision: target.revision,
    baseRulesVersion: model.rulesVersion,
  };
  return {
    ...model,
    updatedAt: at,
    segments: model.segments.map((item) => item.id === segmentId
      ? { ...item, lock, handoff: preserveDraft, staleReason: `已由 ${operator.name} 接管；${previous.holderName} 的留存稿保留待复核` }
      : item),
    relayLog: [...model.relayLog, relayEvent('takeover', `${operator.name} 接管第 ${target.sequence} 段（原由 ${previous.holderName} 占用，留存稿已保留）`, at)].slice(-30),
  };
}

export function releaseLock(model: DeskModel, segmentId: string, operatorId: string, at = Date.now()): DeskModel {
  const target = model.segments.find((item) => item.id === segmentId);
  if (!target?.lock || target.lock.holderId !== operatorId) return model;
  return {
    ...model,
    updatedAt: at,
    segments: model.segments.map((item) => item.id === segmentId ? { ...item, lock: undefined } : item),
    relayLog: [...model.relayLog, relayEvent('release', `${target.lock.holderName} 释放第 ${target.sequence} 段的占用`, at)].slice(-30),
  };
}

/**
 * 被接管的原处理人再次提交：不覆盖直播区，按交接冲突生成一条待复核。
 * 提交内容取接管时为其留存的稿件，直播区内容保持当前处理人的版本。
 */
export function submitHandoffConflict(
  model: DeskModel,
  segmentId: string,
  operator: RelayOperator,
  at = Date.now(),
): { model: DeskModel; review?: PendingReview; reason: 'created' | 'duplicate' | 'not-handoff' } {
  const target = model.segments.find((item) => item.id === segmentId);
  if (!target?.handoff || target.handoff.operatorId !== operator.id) return { model, reason: 'not-handoff' };
  if (target.lock?.holderId === operator.id) return { model, reason: 'not-handoff' };
  const duplicate = model.reviews.find((review) =>
    review.segmentId === segmentId && review.kind === 'handoff' && review.submittedById === operator.id);
  if (duplicate) return { model, review: duplicate, reason: 'duplicate' };

  const holderName = target.lock?.holderName ?? '后续处理人';
  const review: PendingReview = {
    id: `review-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    segmentId,
    sequence: target.sequence,
    kind: 'handoff',
    draftSpeaker: target.handoff.speaker,
    draftText: target.handoff.text,
    draftRevision: target.revision,
    draftRulesVersion: model.rulesVersion,
    submittedAt: at,
    submittedById: operator.id,
    submittedByName: operator.name,
    liveSpeaker: target.speaker,
    liveText: target.corrected,
    liveRulesVersion: model.rulesVersion,
    confirmedByName: holderName,
    reason: `第 ${target.sequence} 段已由 ${holderName} 接管处理，你的提交基于接管前的留存稿，未写入直播区。`,
  };
  return {
    model: {
      ...model,
      updatedAt: at,
      reviews: [...model.reviews, review].sort((a, b) => a.submittedAt - b.submittedAt),
      relayLog: [...model.relayLog, relayEvent('review', `${operator.name} 对第 ${target.sequence} 段的交接提交转入待复核`, at)].slice(-30),
    },
    review,
    reason: 'created',
  };
}

// ---------------------------------------------------------------------------
// 离线恢复：下手版本 + 远端确认 + 术语规则版本冲突
// ---------------------------------------------------------------------------

/** 进入离线校正：记下当前规则版本，离线期间的确认都会携带下手版本。 */
export function takeOffline(model: DeskModel, at = Date.now()): DeskModel {
  return {
    ...model,
    connection: 'offline',
    simulatedDelay: 9,
    updatedAt: at,
    relayLog: [...model.relayLog, relayEvent('reconcile', `连接中断，进入离线校正（术语规则 v${model.rulesVersion}）`, at)].slice(-30),
  };
}

/**
 * 模拟交班同事 / 另一端的操作：
 * - 在线时：交替地占用一个空闲片段，或直接确认一个片段；
 * - 本机离线时：把本机离线发件箱里的片段在“另一端”确认掉，制造恢复冲突。
 */
export function simulateColleagueRelay(model: DeskModel, at = Date.now()): DeskModel {
  const colleague = OPERATORS.find((item) => item.id !== model.currentOperatorId) ?? OPERATORS[1];
  const segments = model.segments.map((item) => ({ ...item }));
  let relayLog = model.relayLog;
  let remoteConfirms = model.remoteConfirms;

  if (model.connection === 'offline') {
    const offlineTarget = segments.find((item) => item.source === 'offline' && item.state === 'confirmed'
      && !remoteConfirms.some((remote) => remote.segmentId === item.id));
    if (!offlineTarget) return model;
    const { text } = applyRules(offlineTarget.corrected, model);
    const candidateText = text !== offlineTarget.corrected ? text : normalizePunctuation(offlineTarget.corrected);
    offlineTarget.corrected = candidateText || offlineTarget.corrected;
    offlineTarget.confirmedAt = at;
    offlineTarget.confirmedBy = colleague.name;
    offlineTarget.staleReason = `离线期间已由 ${colleague.name} 在另一端确认`;
    remoteConfirms = [...remoteConfirms, { segmentId: offlineTarget.id, byName: colleague.name, at }];
    relayLog = [...relayLog, relayEvent('remote', `${colleague.name} 在另一端确认了第 ${offlineTarget.sequence} 段`, at)].slice(-30);
    return { ...model, segments, remoteConfirms, relayLog, updatedAt: at };
  }

  const workable = segments.filter((item) =>
    ['pending', 'stale', 'duplicate'].includes(item.state) && (!item.lock || item.lock.expiresAt < at));
  if (!workable.length) return model;
  const colleagueActionCount = relayLog.filter((event) => event.kind === 'lock' || event.kind === 'remote').length;
  const target = workable[0];

  if (colleagueActionCount % 2 === 0) {
    target.lock = {
      holderId: colleague.id,
      holderName: colleague.name,
      epoch: (target.lock?.epoch ?? 0) + 1,
      acquiredAt: at,
      expiresAt: at + LOCK_TTL_MS,
      ttlMs: LOCK_TTL_MS,
      baseRevision: target.revision,
      baseRulesVersion: model.rulesVersion,
    };
    relayLog = [...relayLog, relayEvent('lock', `${colleague.name} 开始处理第 ${target.sequence} 段，占用 ${Math.round(LOCK_TTL_MS / 1000)} 秒`, at)].slice(-30);
  } else {
    const { text } = applyRules(target.corrected, model);
    target.corrected = text !== target.corrected ? text : normalizePunctuation(target.corrected) || target.corrected;
    target.state = 'confirmed';
    target.confirmedAt = at;
    target.confirmedBy = colleague.name;
    target.lock = undefined;
    relayLog = [...relayLog, relayEvent('remote', `${colleague.name} 已确认第 ${target.sequence} 段并送入直播区`, at)].slice(-30);
  }
  return { ...model, segments, relayLog, updatedAt: at };
}

/** 模拟交班同事在另一端更新术语规则，规则版本 +1。 */
export function bumpTermRulesByColleague(model: DeskModel, at = Date.now()): DeskModel {
  const colleague = OPERATORS.find((item) => item.id !== model.currentOperatorId) ?? OPERATORS[1];
  const existingA = model.rules.find((rule) => rule.id === 'term-colleague-1');
  let rules = model.rules;
  if (!existingA) {
    rules = [{
      id: 'term-colleague-1',
      source: 'copilot',
      replacement: 'Copilot',
      speaker: '',
      enabled: true,
      caseSensitive: false,
      usageCount: 0,
      createdAt: at,
    }, ...model.rules];
  } else {
    const upgraded = existingA.replacement === 'Copilot';
    rules = model.rules.map((rule) => rule.id === 'term-colleague-1'
      ? { ...rule, replacement: upgraded ? 'Copilot Pro' : 'Copilot' }
      : rule);
  }
  return {
    ...model,
    rules,
    rulesVersion: model.rulesVersion + 1,
    updatedAt: at,
    relayLog: [...model.relayLog, relayEvent('rules', `${colleague.name} 更新术语规则至 v${model.rulesVersion + 1}`, at)].slice(-30),
  };
}

/**
 * 恢复连接后的顺序合并：
 * 离线期间的改动带着下手时的版本恢复；已被他人确认、或术语规则已改版的旧改动
 * 不直接进入直播区，按发生顺序生成待复核冲突，由人工逐条决定。
 */
export function reconcileOfflineChanges(model: DeskModel): DeskModel {
  const at = Date.now();
  const current = cloneModel(model);
  const remoteMap = new Map(current.remoteConfirms.map((remote) => [remote.segmentId, remote]));
  const newReviews: PendingReview[] = [];
  const consumedRemote = new Set<string>();

  let segments = current.segments.map((item): CaptionSegment => {
    if (!(item.source === 'offline' && item.state === 'confirmed')) return item;
    const remote = remoteMap.get(item.id);
    const draftText = item.offlineDraftText ?? item.corrected;
    const draftSpeaker = item.offlineDraftSpeaker ?? item.speaker;
    const baseRevision = item.offlineBaseRevision ?? item.revision;
    const baseRulesVersion = item.offlineBaseRulesVersion ?? current.rulesVersion;
    const submitterName = item.confirmedBy ?? '离线校对员';
    const submittedAt = item.confirmedAt ?? at;

    const base: CaptionSegment = {
      ...item,
      lock: undefined,
      tags: [...new Set([...item.tags, '待复核'])],
      state: 'review',
    };

    if (remote) {
      consumedRemote.add(item.id);
      newReviews.push({
        id: `review-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        segmentId: item.id,
        sequence: item.sequence,
        kind: 'remote-confirmed',
        draftSpeaker,
        draftText,
        draftRevision: baseRevision,
        draftRulesVersion: baseRulesVersion,
        submittedAt,
        submittedById: current.currentOperatorId,
        submittedByName: submitterName,
        liveSpeaker: item.speaker,
        liveText: item.corrected,
        liveRulesVersion: current.rulesVersion,
        confirmedByName: remote.byName,
        reason: `离线期间第 ${item.sequence} 段已由 ${remote.byName} 确认进入直播区；你的改动基于离线前第 r${baseRevision} 版，不能直接覆盖。`,
      });
      return base;
    }

    if (baseRulesVersion < current.rulesVersion) {
      newReviews.push({
        id: `review-${at.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        segmentId: item.id,
        sequence: item.sequence,
        kind: 'rules-changed',
        draftSpeaker,
        draftText,
        draftRevision: baseRevision,
        draftRulesVersion: baseRulesVersion,
        submittedAt,
        submittedById: current.currentOperatorId,
        submittedByName: submitterName,
        liveSpeaker: item.speaker,
        liveText: item.corrected,
        liveRulesVersion: current.rulesVersion,
        reason: `该改动按术语规则 v${baseRulesVersion} 下手，现行规则已是 v${current.rulesVersion}，请按新规则复核后再进直播区。`,
      });
      return base;
    }

    // 无冲突：按发生顺序直接落直播区。
    return {
      ...item,
      source: 'live',
      state: 'confirmed',
      confirmedAt: submittedAt,
      lock: undefined,
      offlineBaseRevision: undefined,
      offlineBaseRulesVersion: undefined,
      offlineDraftSpeaker: undefined,
      offlineDraftText: undefined,
      staleReason: undefined,
    };
  });

  // 没有离线改动、但另一端确认了的片段，直接采用远端结果。
  for (const remote of current.remoteConfirms) {
    if (consumedRemote.has(remote.segmentId)) continue;
    segments = segments.map((item) => item.id === remote.segmentId
      ? { ...item, state: 'confirmed' as SegmentState, source: 'live' as SegmentSource, confirmedAt: remote.at, confirmedBy: remote.byName, lock: undefined }
      : item);
  }

  // 重复 / 过期再检查，但不覆盖已进入待复核的片段。
  const seen: string[] = [];
  segments = segments
    .sort((a, b) => a.sequence - b.sequence || a.startTime - b.startTime)
    .map((item): CaptionSegment => {
      if (item.source === 'offline' && item.state === 'confirmed') {
        item.staleReason = at - item.receivedAt > 90_000
          ? `离线恢复后合并，原始片段已延迟 ${Math.round((at - item.receivedAt) / 1000)} 秒`
          : item.staleReason;
        if (item.staleReason && at - item.receivedAt > 90_000) item.state = 'stale';
      }
      const duplicate = isDuplicate(item, seen.map((id) => segments.find((segmentItem) => segmentItem.id === id)).filter(Boolean) as CaptionSegment[]);
      if (duplicate && item.state === 'pending') {
        item.state = 'duplicate';
        item.duplicateOf = duplicate.id;
      }
      if (item.state !== 'ignored' && item.state !== 'review') seen.push(item.id);
      return item;
    });

  return {
    ...current,
    segments,
    reviews: [...current.reviews, ...newReviews].sort((a, b) => a.submittedAt - b.submittedAt),
    remoteConfirms: [],
    connection: 'connected',
    simulatedDelay: Math.max(0.8, current.simulatedDelay - 0.7),
    lastMergedAt: at,
    updatedAt: at,
    relayLog: [...current.relayLog, relayEvent('reconcile', `连接恢复，离线发件箱已按顺序合并，${newReviews.length} 条转入待复核`, at)].slice(-30),
  };
}

/** 人工对一条待复核冲突作出决定。 */
export function resolveReview(model: DeskModel, reviewId: string, decision: ReviewDecision, at = Date.now()): DeskModel {
  const review = model.reviews.find((item) => item.id === reviewId);
  if (!review) return model;
  const clearOffline = (item: CaptionSegment): CaptionSegment => ({
    ...item,
    source: 'live',
    offlineBaseRevision: undefined,
    offlineBaseRulesVersion: undefined,
    offlineDraftSpeaker: undefined,
    offlineDraftText: undefined,
  });
  const segments = model.segments.map((item): CaptionSegment => {
    if (item.id !== review.segmentId) return item;
    if (review.kind === 'handoff') {
      const cleared = { ...item, handoff: undefined };
      if (decision === 'apply-draft') {
        return {
          ...cleared,
          speaker: review.draftSpeaker,
          corrected: review.draftText,
          state: 'pending',
          staleReason: `接力复核：已采用 ${review.submittedByName} 的留存稿，请核对后确认`,
          tags: [...new Set([...item.tags, '采用留存稿'])],
        };
      }
      if (decision === 'discard') {
        return { ...cleared, state: 'pending', staleReason: `接力复核：已舍弃 ${review.submittedByName} 的留存稿` };
      }
      return { ...cleared, state: 'pending', staleReason: `接力复核：保留 ${review.confirmedByName ?? '当前处理人'} 的版本继续校对` };
    }

    if (review.kind === 'remote-confirmed') {
      if (decision === 'replay') {
        return {
          ...clearOffline(item),
          speaker: review.draftSpeaker,
          corrected: review.draftText,
          state: 'confirmed',
          confirmedAt: at,
          staleReason: undefined,
          tags: [...new Set([...item.tags, '离线复核重放'])],
        };
      }
      // keep-live / discard 都保留直播区版本，仅清离线标记。
      return { ...clearOffline(item), state: 'confirmed', staleReason: undefined };
    }

    // rules-changed
    if (decision === 'apply-draft') {
      return {
        ...clearOffline(item),
        speaker: review.draftSpeaker,
        corrected: review.draftText,
        state: 'confirmed',
        confirmedAt: at,
        staleReason: undefined,
        tags: [...new Set([...item.tags, `按 v${review.draftRulesVersion} 规则人工确认`])],
      };
    }
    if (decision === 'recheck') {
      return {
        ...clearOffline(item),
        speaker: review.draftSpeaker,
        corrected: review.draftText,
        state: 'pending',
        staleReason: `术语规则已从 v${review.draftRulesVersion} 更新到 v${review.liveRulesVersion}，请按新规则重新核对`,
      };
    }
    // discard：舍弃离线稿，片段回到待确认，以直播区现行文本为准。
    return {
      ...clearOffline(item),
      state: 'pending',
      corrected: review.liveText,
      speaker: review.liveSpeaker,
      staleReason: `已舍弃基于 v${review.draftRulesVersion} 的离线改动`,
    };
  });

  return {
    ...model,
    segments,
    reviews: model.reviews.filter((item) => item.id !== reviewId),
    updatedAt: at,
    relayLog: [...model.relayLog, relayEvent('review', `第 ${review.sequence} 段的待复核冲突已处理（${decision}）`, at)].slice(-30),
  };
}

// ---------------------------------------------------------------------------
// 队列统计 / 直播流模拟 / 导出
// ---------------------------------------------------------------------------

export function queueStats(model: DeskModel, at = Date.now()) {
  const pending = model.segments.filter((item) => item.state === 'pending');
  const stale = model.segments.filter((item) => item.state === 'stale');
  const duplicate = model.segments.filter((item) => item.state === 'duplicate');
  const review = model.reviews.length;
  const offline = model.segments.filter((item) => item.source === 'offline' && item.state === 'confirmed');
  const locksHeldByOthers = model.segments.filter((item) => item.lock && item.lock.holderId !== model.currentOperatorId && item.lock.expiresAt > at).length;
  return {
    pending: pending.length,
    stale: stale.length,
    duplicate: duplicate.length,
    review,
    offline: offline.length,
    locksHeldByOthers,
    backlog: pending.length + stale.length + duplicate.length + offline.length + review,
    oldestWaitSeconds: pending.length ? Math.max(...pending.map((item) => Math.max(0, Math.round((at - item.receivedAt) / 1000)))) : 0,
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
