// Almanac web service: the C.C. Lime ApplicationService command set, served by the
// Satchel shell. Identity, sign-in, MFA and account deletion belong to Satchel, so
// those commands are gone. Each signed-in person gets their own service instance.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { JsonStore, emptyState, type CalendarState } from './json-store';
import { ReminderScheduler, type ReminderNotice } from './scheduler';
import { avatarCropSchema } from '../shared/avatar-crop';
import { PROFILE_ID, profileSchema, avatarSchema, type UserProfile } from '../shared/model';
import { appearanceSchema, defaultAppearance } from '../shared/appearance';
import { atDate, recurringDates, sourceDate, addDays, localInstant, expand, timingLabel } from '../domain/calendar';
import { createBackup, readBackup, remapBackup, previewImport, parseCalendar, exportCalendar, type ParseOptions } from '../domain/interchange';
import { seriesImpact, seriesChanges, semesterClass, type SchedulePreview, type RecordChange } from '../domain/schedule-changes';
import { defaultDeviceSettings, parseRecord, preferencesSchema, itemSchema, semesterSchema, localDate, localTime, uid, zone as zoneSchema, type DomainRecord, type ImportPreview, type Preferences, type Snapshot, type CalendarItem, type Semester, type NotificationTest } from '../shared/model';

export const VERSION = '1.0.0';
const deviceSchema = z.object({ notifications: z.boolean(), startAtLogin: z.boolean(), closeToTray: z.boolean(), quietStart: localTime.nullable(), quietEnd: localTime.nullable(), privacy: z.boolean(), followZone: z.boolean(), onboardingDone: z.boolean(), view: z.enum(['month', 'week', 'agenda']), month: z.string().regex(/^\d{4}-\d{2}$/).nullable(), hideCompleted: z.boolean(), weekScale: z.number().int().min(20).max(100).nullable(), showWeekAllDay: z.boolean() }).strict();
const MAX_TEXT = 10 * 1024 * 1024;

export interface SatchelUser { id: string; email: string; name: string; createdAt?: string }
export interface WebNotice { id: string; title: string; body: string; itemId?: string; occurrenceKey?: string; inbox?: boolean }

export class WebCalendarService {
  readonly store: JsonStore;
  private scheduler: ReminderScheduler;
  private imports = new Map<string, { preview: ImportPreview; before: Map<string, string>; expires: number }>();
  private restorePreview: { token: string; records: DomainRecord[]; foreign: boolean; count: number; expires: number } | null = null;
  private schedulePreview: { token: string; revision: string; expires: number; semester: Semester | null; pairs: Array<{ before: CalendarItem | null; after: CalendarItem }> } | null = null;
  private notificationTest: NotificationTest | null = null;
  private notices: WebNotice[] = [];
  lastUsed = Date.now();
  browserZone: string | null = null;

  constructor(private user: SatchelUser, state: CalendarState, persist: () => void) {
    this.store = new JsonStore(user.id, state, persist);
    if (!this.store.metadata('profileFirstUsed', '')) this.store.setMetadata('profileFirstUsed', new Date().toISOString());
    this.store.retainCompletionHistory();
    this.scheduler = new ReminderScheduler(this.store, () => this.device, () => this.displayZone(), n => this.notify(n), () => {});
    this.scheduler.start();
  }
  get device() { return this.store.state.device; }
  updateUser(user: SatchelUser) { this.user = user; }
  stop() { this.scheduler.stop(); }

  private notify(notice: ReminderNotice) {
    // Browsers show these with the Notification API the next time the open tab polls.
    this.notices.push({ id: randomUUID(), title: notice.title, body: notice.body, itemId: notice.itemId, occurrenceKey: notice.occurrenceKey, inbox: notice.inbox });
    if (this.notices.length > 50) this.notices.splice(0, this.notices.length - 50);
  }
  preferences(): Preferences {
    const existing = this.store.list().find((r): r is Preferences => r.kind === 'preferences');
    return existing ?? preferencesSchema.parse({ id: 'c44ba791-5ae6-5ec6-9813-0c840db2f0f2', kind: 'preferences', zone: this.browserZone ?? 'UTC' });
  }
  private displayZone(): string {
    const fixed = this.preferences().zone; if (!this.device.followZone) return fixed;
    const z2 = zoneSchema.safeParse(this.browserZone ?? fixed); return z2.success ? z2.data : fixed;
  }
  private changed() { this.scheduler.reconcile(); }
  private profile(): UserProfile {
    const saved = this.store.get(PROFILE_ID); if (saved?.kind === 'profile') return saved;
    return profileSchema.parse({ id: PROFILE_ID, kind: 'profile', name: this.user.name?.trim() || 'Student', avatar: null, joinedAt: this.user.createdAt ?? null, appearance: defaultAppearance });
  }
  snapshot(): Snapshot {
    const store = this.store;
    return {
      records: store.list(), recordsRevision: store.listRevision(), profile: this.profile(), localCreatedAt: store.metadata('profileFirstUsed', undefined),
      displayZone: this.displayZone(), notificationTest: this.notificationTest,
      session: { uid: this.user.id, email: this.user.email, displayName: this.user.name, verified: true, providers: ['satchel'], createdAt: this.user.createdAt },
      mfaChallenge: null, signInNotice: null, device: this.device,
      sync: { state: 'synced', pending: 0, lastSynced: new Date().toISOString(), message: 'Saved to your Satchel account.' },
      conflicts: [], reminders: store.reminderInbox(), configured: true, googleConfigured: false, version: VERSION, localMode: false, deleting: false,
    };
  }
  takeNotices(): WebNotice[] { const n = this.notices; this.notices = []; return n; }

  command(command: string, payload: any): any {
    this.lastUsed = Date.now();
    const store = this.store;
    switch (command) {
      case 'snapshot': {
        const p = z.object({ recordsRevision: z.string().max(200).optional(), zone: z.string().max(100).optional() }).strict().parse(payload ?? {});
        if (p.zone && zoneSchema.safeParse(p.zone).success) this.browserZone = p.zone;
        const snapshot = this.snapshot();
        if (p.recordsRevision && p.recordsRevision === snapshot.recordsRevision) { const { records, ...update } = snapshot; return { ...update, notices: this.takeNotices() }; }
        return { ...snapshot, notices: this.takeNotices() };
      }
      case 'profile.save': { const p = z.object({ name: z.string().trim().min(1).max(100) }).strict().parse(payload); store.save({ ...this.profile(), name: p.name }); this.changed(); return true; }
      // The browser crops the photo itself (see web-bridge.ts) and sends the finished 128px PNG.
      case 'profile.avatar': { const p = z.object({ avatar: avatarSchema }).strict().parse(payload); store.save({ ...this.profile(), avatar: p.avatar }); this.changed(); return true; }
      case 'profile.removePhoto': store.save({ ...this.profile(), avatar: null }); this.changed(); return true;
      case 'appearance': { const appearance = appearanceSchema.parse(payload); store.save({ ...this.profile(), appearance }); this.changed(); return true; }
      case 'schedule.preview': {
        const p = z.object({ value: z.union([itemSchema, semesterSchema]), from: localDate.optional(), to: localDate.optional(), restoreOldBreaks: z.boolean().default(false) }).strict().parse(payload);
        const records = store.list(), previous = store.get(p.value.id);
        const pairs: Array<{ before: CalendarItem | null; after: CalendarItem }> = []; const warnings: string[] = [];
        let from: string, to: string, semester: Semester | null = null;
        if (p.value.kind === 'semester') {
          if (previous?.kind !== 'semester') throw new Error('Save the semester before changing its timetable.');
          semester = p.value; const courseIds = new Set(records.filter(r => r.kind === 'course' && r.semesterId === semester!.id).map(r => r.id));
          for (const record of records) if (record.kind === 'item' && record.itemType === 'class' && record.recurrence && record.courseId && courseIds.has(record.courseId)) pairs.push({ before: record, after: semesterClass(record, previous, semester, p.restoreOldBreaks) });
          from = previous.startDate < semester.startDate ? previous.startDate : semester.startDate; to = previous.endDate > semester.endDate ? previous.endDate : semester.endDate;
          warnings.push('Timetable changes apply only to repeating classes in this semester. Assignments, exams and independent events keep their dates.');
          warnings.push('Class patterns keep their interval phase and wall-clock start time, use the semester time zone, and end on the new semester end date. Occurrence-count endings are replaced.');
          warnings.push(p.restoreOldBreaks ? 'Exclusions inside previous semester breaks will be replaced, including manually excluded dates in those ranges. Other exclusions remain.' : 'Previously excluded dates stay excluded. The new semester breaks are added.');
        } else {
          if (previous && previous.kind !== 'item') throw new Error('This identity belongs to another record type.');
          const before = previous?.kind === 'item' ? previous : null; pairs.push({ before, after: p.value });
          const first = sourceDate(p.value.timing) ?? DateTime.now().setZone(p.value.timing.zone).toISODate()!;
          const oldFirst = before ? sourceDate(before.timing) : null; from = oldFirst && oldFirst < first ? oldFirst : first;
          const end = p.value.recurrence?.until ?? before?.recurrence?.until;
          to = end && end >= from ? end : DateTime.fromISO(from).plus({ years: 1 }).toISODate()!;
        }
        from = p.from ?? from; to = p.to ?? (to > '2100-12-31' ? '2100-12-31' : to);
        if (to < from) throw new Error('The preview end must be on or after its start.');
        const series = pairs.map(pair => seriesImpact(pair.before, pair.after, records, from, to));
        if (series.reduce((sum, s) => sum + s.beforeCount + s.afterCount, 0) > 20000) throw new Error('This preview exceeds 20,000 meetings. Choose a shorter preview range.');
        const token = randomUUID(); this.schedulePreview = { token, revision: store.listRevision(), expires: Date.now() + 10 * 60 * 1000, semester, pairs };
        const result: SchedulePreview = { token, kind: semester ? 'semester' : 'series', from, to, series, historyCount: series.reduce((sum, s) => sum + s.affectedHistory.length, 0), warnings, restoreOldBreaks: p.restoreOldBreaks };
        return result;
      }
      case 'schedule.commit': {
        const p = z.object({ token: uid, history: z.enum(['preserve', 'discard']), applyTimetable: z.boolean().default(true) }).strict().parse(payload), preview = this.schedulePreview;
        if (!preview || preview.token !== p.token || preview.expires < Date.now()) throw new Error('This preview has expired. Review the schedule again.');
        if (store.listRevision() !== preview.revision) throw new Error('Your calendar changed after this preview. Review the latest schedule before applying it.');
        if (!preview.semester && !p.applyTimetable) throw new Error('A series change must apply the reviewed schedule.');
        const changes: RecordChange[] = preview.semester ? [{ id: preview.semester.id, value: preview.semester }] : [];
        if (p.applyTimetable) for (const pair of preview.pairs) changes.push(...seriesChanges(pair.before, pair.after, store.list(), p.history, randomUUID));
        const result = store.saveGroup(changes); this.schedulePreview = null; this.changed(); return result;
      }
      case 'schedule.cancel': this.schedulePreview = null; return true;
      case 'save': {
        const value = parseRecord(payload);
        if (value.kind === 'item') {
          if (value.timing.mode === 'deadline') localInstant(value.timing.date, value.timing.time ?? value.timing.anchorTime, value.timing.zone);
          const old = store.get(value.id); if (old?.kind === 'item' && old.recurrence) {
            const dependent = store.list().filter(r => (r.kind === 'exception' || r.kind === 'occurrenceState') && r.seriesId === value.id);
            const removed = dependent.filter(r => (r.kind === 'exception' || r.kind === 'occurrenceState') && (!value.recurrence || !recurringDates(value, r.originalDate, addDays(r.originalDate, 1)).includes(r.originalDate)));
            if (removed.some(r => r.kind !== 'exception' || !r.cancelled)) throw new Error('This repeat change removes an occurrence with an edit or completion history. Keep the current pattern, or detach those occurrences first.');
            if (removed.length) { const result = store.saveGroup([{ id: value.id, value }, ...removed.map(r => ({ id: r.id, value: null }))]); this.changed(); return result; }
          }
        }
        const result = store.save(value); this.changed(); return result;
      }
      case 'remove': { const p = z.object({ id: uid }).strict().parse(payload); const token = store.remove(p.id); this.changed(); return { undoToken: token }; }
      case 'undo': { const p = z.object({ token: uid }).strict().parse(payload); store.undo(p.token); this.changed(); return true; }
      case 'occurrence': {
        const p = z.object({ seriesId: uid, date: localDate, action: z.enum(['save', 'cancel', 'complete', 'reopen', 'detach']), override: z.unknown().optional() }).strict().parse(payload); const series = store.get(p.seriesId);
        if (series?.kind !== 'item' || !series.recurrence) throw new Error('This repeating item is unavailable.');
        if (p.action === 'complete' || p.action === 'reopen') {
          const old = store.list().find(r => r.kind === 'occurrenceState' && r.seriesId === p.seriesId && r.originalDate === p.date);
          store.save({ id: old?.id ?? randomUUID(), kind: 'occurrenceState', seriesId: p.seriesId, originalDate: p.date, status: p.action === 'complete' ? 'completed' : 'open', completedAt: p.action === 'complete' ? new Date().toISOString() : null });
        } else {
          const old = store.list().find(r => r.kind === 'exception' && r.seriesId === p.seriesId && r.originalDate === p.date);
          if (p.action === 'detach') {
            const effective = old?.kind === 'exception' ? old.override : {};
            const state = store.list().find(r => r.kind === 'occurrenceState' && r.seriesId === p.seriesId && r.originalDate === p.date);
            const independent = parseRecord({ ...series, ...effective, ...(state?.kind === 'occurrenceState' ? { status: state.status, completedAt: state.completedAt } : {}), id: randomUUID(), timing: effective.timing ?? atDate(series.timing, p.date), recurrence: null, sourceUid: null });
            const cancellation = parseRecord({ id: old?.id ?? randomUUID(), kind: 'exception', seriesId: p.seriesId, originalDate: p.date, cancelled: true, override: {} });
            store.saveGroup([{ id: independent.id, value: independent }, { id: cancellation.id, value: cancellation }, ...(state ? [{ id: state.id, value: null }] : [])]);
          } else store.save({ id: old?.id ?? randomUUID(), kind: 'exception', seriesId: p.seriesId, originalDate: p.date, cancelled: p.action === 'cancel', override: p.action === 'save' ? p.override ?? {} : {} });
        }
        this.changed(); return true;
      }
      case 'complete': {
        const p = z.object({ id: uid, completed: z.boolean() }).strict().parse(payload), item = store.get(p.id); if (item?.kind !== 'item') throw new Error('Item not found.'); if (item.recurrence) throw new Error('Choose a specific occurrence to complete.');
        const result = store.save({ ...item, status: p.completed ? 'completed' : 'open', completedAt: p.completed ? new Date().toISOString() : null }); this.changed(); return result;
      }
      case 'device': {
        const next = deviceSchema.parse({ ...defaultDeviceSettings, ...this.device, ...payload });
        store.state.device = next; store.setMetadata('deviceSaved', Date.now()); this.changed(); return true;
      }
      case 'sync': return true;
      case 'testNotification': {
        this.notificationTest = { state: 'submitted', checkedAt: new Date().toISOString(), message: 'Test reminder sent to this browser. If no banner appears, allow notifications for this site in your browser settings.' };
        this.notify({ title: 'Almanac', body: 'Your test reminder is ready.', inbox: false, onFailure: () => {} });
        return this.notificationTest;
      }
      case 'snooze': { const p = z.object({ id: z.string().max(250), minutes: z.number() }).strict().parse(payload); this.scheduler.snooze(p.id, p.minutes); return true; }
      case 'dismissReminder': this.scheduler.dismiss(z.object({ id: z.string().max(250) }).strict().parse(payload).id); return true;
      // Files are chosen in the browser; the bridge sends their text here.
      case 'import.preview': {
        const p = z.object({ zone: zoneSchema, finiteRange: z.object({ from: localDate, to: localDate }).optional(), text: z.string().max(MAX_TEXT), filename: z.string().max(260) }).strict().parse(payload);
        const parsed = parseCalendar(p.text, { zone: p.zone, finiteRange: p.finiteRange } as ParseOptions);
        const preview: ImportPreview = { token: randomUUID(), filename: p.filename, candidates: previewImport(parsed, store.list()), warnings: parsed.warnings, invalid: parsed.invalid };
        this.imports.clear(); this.imports.set(preview.token, { preview, before: new Map(preview.candidates.map(c => [c.record.id, JSON.stringify(store.get(c.record.id))])), expires: Date.now() + 30 * 60 * 1000 }); return preview;
      }
      case 'import.cancel': this.imports.clear(); return true;
      case 'import.commit': {
        const p = z.object({ token: uid, includeChanged: z.boolean() }).strict().parse(payload), stored = this.imports.get(p.token); if (!stored || stored.expires < Date.now()) throw new Error('Preview expired. Preview the file again.');
        const candidates = stored.preview.candidates.filter(c => c.action === 'new' || p.includeChanged && c.action === 'changed'); const idSet = new Set(candidates.map(c => c.record.id));
        if (candidates.some(c => JSON.stringify(store.get(c.record.id)) !== stored.before.get(c.record.id))) throw new Error('Your calendar changed after this preview. Preview the file again before importing.');
        const values = candidates.filter(c => c.record.kind !== 'exception' || idSet.has(c.record.seriesId) || store.get(c.record.seriesId)).map(c => c.record);
        const batch = store.importRecords(values); this.imports.delete(p.token); this.changed(); return { batch, count: values.length };
      }
      case 'import.undo': store.undoImport(z.object({ batch: uid }).strict().parse(payload).batch); this.changed(); return true;
      case 'export': {
        const p = z.object({ courses: z.array(uid).max(1000).optional(), range: z.object({ from: localDate, to: localDate }).optional() }).strict().parse(payload ?? {});
        return { filename: 'almanac-calendar.ics', type: 'text/calendar', text: exportCalendar(store.list(), { ...p, zone: this.preferences().zone }) };
      }
      case 'backup': return { filename: `almanac-backup-${DateTime.now().toISODate()}.json`, type: 'application/json', text: createBackup(store.accountId, store.list()) };
      case 'restore.preview': {
        const p = z.object({ text: z.string().max(50 * 1024 * 1024), filename: z.string().max(260) }).strict().parse(payload);
        const backup = readBackup(p.text), token = randomUUID(), foreign = backup.accountId !== store.accountId;
        this.restorePreview = { token, records: backup.records, foreign, count: backup.records.length, expires: Date.now() + 30 * 60 * 1000 };
        return { token, count: backup.records.length, foreign, createdAt: backup.createdAt, filename: p.filename };
      }
      case 'restore.commit': {
        const p = z.object({ token: uid, mode: z.enum(['copies', 'merge']) }).strict().parse(payload), preview = this.restorePreview; if (!preview || preview.token !== p.token || preview.expires < Date.now()) throw new Error('Restore preview expired.');
        let values = preview.records;
        if (preview.foreign || p.mode === 'copies') values = remapBackup(values, store.list().find(r => r.kind === 'preferences')?.id);
        else if (values.some(r => store.get(r.id) && JSON.stringify(store.get(r.id)) !== JSON.stringify(r))) throw new Error('Existing items differ from this backup. Restore as separate copies to preserve both versions.');
        store.snapshot('before-restore'); store.importRecords(values.filter(v => JSON.stringify(store.get(v.id)) !== JSON.stringify(v))); this.restorePreview = null; this.changed(); return true;
      }
      default: throw new Error('This action is not available in Almanac.');
    }
  }
}

// ---------- multi-user registry used by the Satchel server ----------
export interface StateHost { load(userId: string): CalendarState | undefined; save(userId: string, state: CalendarState): void; persist(): void }
const services = new Map<string, WebCalendarService>();
const RATE = new Map<string, number[]>();

export function serviceFor(user: SatchelUser, host: StateHost): WebCalendarService {
  let service = services.get(user.id);
  if (!service) {
    let state = host.load(user.id);
    if (!state) { state = emptyState(); host.save(user.id, state); }
    service = new WebCalendarService(user, state, () => host.persist());
    services.set(user.id, service);
  } else service.updateUser(user);
  return service;
}
export function run(user: SatchelUser, host: StateHost, command: string, payload: unknown): unknown {
  if (typeof command !== 'string' || command.length > 60) throw new Error('This action is not available in Almanac.');
  const now = Date.now(), times = (RATE.get(user.id) ?? []).filter(t => t > now - 60000);
  if (times.length > 600) throw new Error('Too many calendar actions. Wait a moment and try again.');
  times.push(now); RATE.set(user.id, times);
  return serviceFor(user, host).command(command, payload);
}
/** Forget a person's calendar service (sign-out of every session, or account deletion). */
export function release(userId: string): void { services.get(userId)?.stop(); services.delete(userId); RATE.delete(userId); }
// Stop reminder timers for calendars nobody has opened for two hours.
setInterval(() => { const cutoff = Date.now() - 2 * 3600000; for (const [id, s] of services) if (s.lastUsed < cutoff) release(id); }, 600000).unref();

/** Next few items for the Satchel dashboard (today onward, cancelled/completed hidden). */
export function upcomingSummary(user: SatchelUser, host: StateHost, limit = 5): Array<{ title: string; when: string; type: string; color: string | null }> {
  const service = serviceFor(user, host), zone = service.snapshot().displayZone ?? 'UTC', prefs = service.preferences();
  const records = service.store.list(), now = Date.now();
  const today = DateTime.now().setZone(zone).toISODate()!;
  const courses = new Map(records.filter(r => r.kind === 'course').map(r => [r.id, r]));
  return expand(records, today, addDays(today, 14), zone, 500)
    .filter(o => o.status !== 'completed' && (o.endMs ?? o.startMs ?? now) >= now)
    .slice(0, limit)
    .map(o => {
      const course = o.courseId ? courses.get(o.courseId) : undefined;
      return { title: o.title, when: `${DateTime.fromISO(o.date).toFormat('ccc d LLL')} · ${timingLabel(o, zone, prefs.timeFormat)}`, type: o.itemType, color: course?.kind === 'course' ? course.color : null };
    });
}
