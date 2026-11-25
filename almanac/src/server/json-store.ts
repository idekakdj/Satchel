// Almanac web store: the C.C. Lime LocalStore interface, kept in a plain JSON
// object owned by the Satchel shell store (encrypted at rest there). There is no
// cloud outbox or conflict queue: the Satchel server is the single source of truth.
import { createHash, randomUUID } from 'node:crypto';
import { parseRecord, type Conflict, type DomainRecord, type ReminderEntry, type DeviceSettings, defaultDeviceSettings } from '../shared/model';
import { recurringDates, validateTiming } from '../domain/calendar';
import { completionFor } from './profile';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Change = { id: string; value: DomainRecord | null };

export interface CalendarState {
  records: Record<string, DomainRecord>;
  meta: Record<string, unknown>;
  reminders: Record<string, ReminderEntry>;
  delivered: Record<string, number>;
  undo: Record<string, { expires: number; before: Change[]; afterHash: string }>;
  batches: Record<string, { createdAt: string; before: Change[]; after: DomainRecord[] }>;
  device: DeviceSettings;
  revision: number;
  safetyCopy?: { label: string; createdAt: string; records: DomainRecord[] } | null;
}

export function emptyState(): CalendarState {
  return { records: {}, meta: {}, reminders: {}, delivered: {}, undo: {}, batches: {}, device: { ...defaultDeviceSettings }, revision: 0, safetyCopy: null };
}

const MAX_RECORDS = 50000;

export class JsonStore {
  private instance = randomUUID();
  private cached: { key: string; records: DomainRecord[] } | null = null;
  constructor(readonly accountId: string, readonly state: CalendarState, private persist: () => void) {
    this.pruneExpiredUndo();
    for (const entry of this.reminders()) if (entry.state === 'dispatching') this.putReminder({ ...entry, state: 'uncertain' });
  }
  get directory(): string { return `satchel:${this.accountId}`; }
  listRevision(): string { return `${this.instance}:${this.state.revision}`; }
  list(): DomainRecord[] {
    const key = this.listRevision(); if (this.cached?.key === key) return this.cached.records;
    const records = Object.keys(this.state.records).sort().map(id => this.state.records[id]);
    this.cached = { key, records }; return records;
  }
  get(id: string): DomainRecord | null { return Object.hasOwn(this.state.records, id) ? this.state.records[id] : null; }
  metadata<T>(key: string, fallback: T): T { return Object.hasOwn(this.state.meta, key) ? this.state.meta[key] as T : fallback; }
  setMetadata(key: string, value: unknown): void { this.state.meta[key] = value; this.persist(); }
  /** Keeps one safety copy of the records (for example before a restore). */
  snapshot(label = 'manual'): string {
    this.state.safetyCopy = { label, createdAt: new Date().toISOString(), records: this.list().slice() }; this.persist(); return label;
  }
  private validateRelations(record: DomainRecord, prospective?: Map<string, DomainRecord>): void {
    const get = (id: string) => prospective ? prospective.get(id) : this.get(id);
    if (record.kind === 'item') {
      validateTiming(record.timing);
      if (record.courseId && get(record.courseId)?.kind !== 'course') throw new Error('The selected course is unavailable.');
      if (record.assignmentId) { const a = get(record.assignmentId); if (a?.kind !== 'item' || a.itemType !== 'assignment') throw new Error('The linked assignment is unavailable.'); }
    }
    if (record.kind === 'course' && record.semesterId && get(record.semesterId)?.kind !== 'semester') throw new Error('The selected semester is unavailable.');
    if (record.kind === 'exception' || record.kind === 'occurrenceState') {
      if (record.kind === 'exception' && record.override.timing) validateTiming(record.override.timing);
      const series = get(record.seriesId);
      if (series?.kind !== 'item' || !series.recurrence) throw new Error('The repeating series is unavailable.');
      const tomorrow = new Date(`${record.originalDate}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      if (!recurringDates(series, record.originalDate, tomorrow.toISOString().slice(0, 10)).includes(record.originalDate)) throw new Error('This date is not an occurrence of the series.');
    }
    // Same uniqueness rules as the SQLite indexes.
    if (record.kind === 'preferences') {
      const other = (prospective ? [...prospective.values()] : this.list()).find(r => r.kind === 'preferences' && r.id !== record.id);
      if (other) throw new Error('Calendar preferences already exist.');
    }
    if (record.kind === 'exception' || record.kind === 'occurrenceState') {
      const other = (prospective ? [...prospective.values()] : this.list()).find(r => r.kind === record.kind && r.id !== record.id && r.seriesId === record.seriesId && r.originalDate === record.originalDate);
      if (other) throw new Error('This occurrence already has a saved change.');
    }
  }
  private write(recordId: string, value: DomainRecord | null): void {
    const existing = this.get(recordId);
    if (value && existing && existing.kind !== value.kind) throw new Error('A record cannot change its type.');
    if (value) {
      if (!existing && Object.keys(this.state.records).length >= MAX_RECORDS) throw new Error('This calendar has reached its 50,000 record limit.');
      this.state.records[recordId] = value;
      const completion = completionFor(value, id => this.get(id));
      if (completion && !this.get(completion.id)) this.state.records[completion.id] = completion;
    } else delete this.state.records[recordId];
    this.state.revision++;
  }
  /** Applies every change, or none if one fails. */
  private transaction(work: () => void): void {
    const before = JSON.stringify({ records: this.state.records, undo: this.state.undo, batches: this.state.batches });
    const revision = this.state.revision;
    try { work(); } catch (error) {
      const saved = JSON.parse(before); this.state.records = saved.records; this.state.undo = saved.undo; this.state.batches = saved.batches; this.state.revision = revision + 1; throw error;
    }
    this.persist();
  }
  retainCompletionHistory(): void {
    const missing = this.list().map(v => completionFor(v, id => this.get(id))).filter(v => v && !this.get(v.id));
    if (missing.length) this.transaction(() => { for (const v of missing) if (v) this.write(v.id, v); });
  }
  saveGroup(inputs: Change[]): { undoToken: string } {
    if (!inputs.length || inputs.length > 5000 || new Set(inputs.map(v => v.id)).size !== inputs.length) throw new Error('A linked change must contain at most 5,000 distinct records.');
    const values = inputs.map(v => ({ id: v.id, value: v.value ? parseRecord(v.value) : null })), prospective = new Map(this.list().map(r => [r.id, r]));
    for (const v of values) { if (v.value) { if (v.id !== v.value.id) throw new Error('Invalid linked identity.'); prospective.set(v.id, v.value); } else prospective.delete(v.id); }
    for (const v of values) if (v.value) this.validateRelations(v.value, prospective);
    this.pruneExpiredUndo(); const before = values.map(v => ({ id: v.id, value: this.get(v.id) })), token = randomUUID();
    this.transaction(() => { for (const v of values) this.write(v.id, v.value); this.state.undo[token] = { expires: Date.now() + 10000, before, afterHash: digest(values) }; });
    return { undoToken: token };
  }
  save(input: unknown): { record: DomainRecord; undoToken: string } {
    const value = parseRecord(input); const prospective = new Map(this.list().map(r => [r.id, r])); prospective.set(value.id, value); this.validateRelations(value, prospective);
    const before = this.get(value.id); this.pruneExpiredUndo(); const token = randomUUID();
    this.transaction(() => { this.write(value.id, value); this.state.undo[token] = { expires: Date.now() + 10000, before: [{ id: value.id, value: before }], afterHash: digest([{ id: value.id, value }]) }; });
    return { record: value, undoToken: token };
  }
  remove(recordId: string): string {
    const existing = this.get(recordId); if (!existing) throw new Error('This item has already been removed.');
    if (existing.kind === 'profile' || existing.kind === 'completion') throw new Error('Use profile controls or account deletion to remove personal profile data.');
    const all = this.list();
    if (existing.kind === 'course' && all.some(r => r.kind === 'item' && r.courseId === recordId)) throw new Error('This course has scheduled items. Archive it instead.');
    if (existing.kind === 'semester' && all.some(r => r.kind === 'course' && r.semesterId === recordId)) throw new Error('This semester has courses. Archive it instead.');
    const children = all.filter(r => (r.kind === 'exception' || r.kind === 'occurrenceState') && r.seriesId === recordId);
    const linked = all.filter(r => r.kind === 'item' && r.assignmentId === recordId);
    const changes: Change[] = [{ id: recordId, value: null }, ...children.map(r => ({ id: r.id, value: null })), ...linked.map(r => ({ id: r.id, value: { ...r, assignmentId: null } as DomainRecord }))];
    const before = changes.map(c => ({ id: c.id, value: this.get(c.id) })), token = randomUUID(); this.pruneExpiredUndo();
    this.transaction(() => { for (const c of changes) this.write(c.id, c.value); this.state.undo[token] = { expires: Date.now() + 10000, before, afterHash: digest(changes) }; });
    return token;
  }
  undo(token: string): void {
    const now = Date.now(); this.pruneExpiredUndo(now);
    const entry = this.state.undo[token];
    if (!entry || entry.expires < now) throw new Error('The undo period has ended.');
    if (digest(entry.before.map(v => ({ id: v.id, value: this.get(v.id) }))) !== entry.afterHash) throw new Error('This item changed again. Review it before restoring an earlier version.');
    this.transaction(() => { for (const old of entry.before) this.write(old.id, old.value); delete this.state.undo[token]; });
  }
  importRecords(inputs: unknown[], batchId: string = randomUUID()): string {
    const values = inputs.map(parseRecord); if (values.length > MAX_RECORDS) throw new Error('A backup batch may contain at most 50,000 records.');
    const prospective = new Map([...this.list(), ...values].map(r => [r.id, r])); for (const v of values) this.validateRelations(v, prospective);
    const before = values.map(v => ({ id: v.id, value: this.get(v.id) }));
    this.transaction(() => {
      for (const v of values) this.write(v.id, v);
      // Keep only the ten most recent import batches for undo.
      const ids = Object.keys(this.state.batches).sort((a, b) => this.state.batches[a].createdAt.localeCompare(this.state.batches[b].createdAt));
      for (const id of ids.slice(0, Math.max(0, ids.length - 9))) delete this.state.batches[id];
      this.state.batches[batchId] = { createdAt: new Date().toISOString(), before, after: values };
    });
    return batchId;
  }
  undoImport(batchId: string): void {
    const batch = this.state.batches[batchId]; if (!batch) throw new Error('Import batch not found.');
    if (batch.after.some(v => digest(this.get(v.id)) !== digest(v))) throw new Error('Some imported items have changed. Review those changes before undoing the import.');
    this.transaction(() => { for (const v of batch.before) this.write(v.id, v.value); delete this.state.batches[batchId]; });
  }
  queueCount(): number { return 0; }
  conflicts(): Conflict[] { return []; }
  pruneExpiredUndo(now = Date.now()): boolean {
    for (const [id, entry] of Object.entries(this.state.undo)) if (entry.expires < now) delete this.state.undo[id];
    return true;
  }
  reminders(): ReminderEntry[] { return Object.values(this.state.reminders).sort((a, b) => (b.snoozeMs ?? b.dueMs) - (a.snoozeMs ?? a.dueMs)); }
  reminderInbox(): ReminderEntry[] { return this.reminders().filter(r => !['pending', 'dismissed'].includes(r.state)).slice(0, 500); }
  putReminder(entry: ReminderEntry): void { this.state.reminders[entry.id] = entry; this.persist(); }
  delivered(id: string): number | null { return Object.hasOwn(this.state.delivered, id) ? this.state.delivered[id] : null; }
  markDelivered(id: string, dueMs: number): void { this.state.delivered[id] = dueMs; this.persist(); }
  pruneReminders(now: number): void {
    for (const [id, r] of Object.entries(this.state.reminders)) if ((r.snoozeMs ?? r.dueMs) < now - 90 * 86400000 && !['pending', 'snoozed', 'dispatching'].includes(r.state)) delete this.state.reminders[id];
    for (const [id, due] of Object.entries(this.state.delivered)) if (due < now - 120 * 86400000) delete this.state.delivered[id];
  }
  close(): void { /* nothing to release */ }
}
