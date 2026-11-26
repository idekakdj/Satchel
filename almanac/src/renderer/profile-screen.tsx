import { useState } from 'react';
import { DateTime } from 'luxon';
import { UserRound, Settings, Palette as PaletteIcon, Check, Pencil, Trash2 } from 'lucide-react';
import { isTask, type Snapshot } from '../shared/model';
import { activePalette, appearanceSchema, defaultAppearance, foreground, presets, type Palette } from '../shared/appearance';
import { openSatchelSettings } from './web-bridge';

type Run = (command: string, payload?: unknown, message?: string) => Promise<any>;
// Name and photo belong to the Satchel account (Settings page), shared by every app.
export function ProfileScreen({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const profile = snapshot.profile;
  const completed = new Set(snapshot.records.filter(r => r.kind === 'completion').map(r => r.kind === 'completion' ? `${r.taskId}:${r.originalDate ?? ''}` : '')).size;
  const open = snapshot.records.filter(r => r.kind === 'item' && isTask(r) && !r.recurrence && r.status !== 'completed').length;
  const joined = snapshot.localMode ? snapshot.localCreatedAt : snapshot.session?.createdAt ?? profile?.joinedAt;
  return <div className="profile-page"><section className="settings-card profile-card"><div className="profile-hero"><span className="avatar profile-photo">{profile?.avatar ? <img src={profile.avatar} alt="Your profile"/> : <UserRound size={46}/>}</span><div><span className="eyebrow">YOUR PERSONAL SPACE</span><h2>{profile?.name ?? 'Student'}</h2><p>{snapshot.session?.email ?? 'Local calendar profile'}</p></div></div>
    <div className="button-row"><button className="button secondary" onClick={() => openSatchelSettings()}><Settings size={16}/> Change name or photo</button></div>
    <p className="field-help">Your name, photo and time zone are Satchel settings, shared by every app. They are not a public profile.</p></section>
    <section className="settings-card"><h2>Your progress</h2><dl className="profile-stats"><div><dt>{snapshot.localMode ? 'Profile tracking since' : 'Joined Almanac'}</dt><dd>{joined ? DateTime.fromISO(joined).toLocaleString(DateTime.DATE_MED) : 'Not available offline'}</dd></div><div><dt>Lifetime tasks completed</dt><dd data-testid="lifetime-completions">{completed.toLocaleString()}</dd></div><div><dt>Open tasks & deadlines</dt><dd>{open.toLocaleString()}</dd></div></dl><p className="field-help">Each task, assignment, exam or study occurrence counts once, even if you reopen or delete it later. Available earlier completions are included; tasks deleted before progress tracking began cannot be recovered.</p>{!snapshot.localMode && !joined && <button className="text-button" onClick={() => run('auth.refresh', undefined, 'Account details refreshed')}>Refresh account details</button>}</section></div>;
}

export function AppearanceSettings({ snapshot, run }: { snapshot: Snapshot; run: Run }) {
  const appearance = snapshot.profile?.appearance ?? defaultAppearance;
  const [editing, setEditing] = useState<string | null | undefined>(), [name, setName] = useState(''), [colors, setColors] = useState<Palette>(activePalette(appearance)), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  function edit(id: string | null) { const saved = appearance.custom.find(t => t.id === id); setEditing(id); setName(saved?.name ?? 'My theme'); setColors(saved?.colors ?? activePalette(appearance)); setError(''); }
  async function save() {
    const id = editing ?? crypto.randomUUID();
    if (editing && !appearance.custom.some(t => t.id === editing)) { setError('This theme was removed on another device. Create a new saved theme.'); return; }
    const next = { active: id, custom: [...appearance.custom.filter(t => t.id !== id), { id, name, colors }] }, parsed = appearanceSchema.safeParse(next);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setBusy(true); try { if (await run('appearance', parsed.data, 'Custom theme saved and applied')) setEditing(undefined); } finally { setBusy(false); }
  }
  return <section className="settings-card appearance-settings"><h2><PaletteIcon size={18}/> Appearance</h2><p className="field-help">Choose a preset, or save up to three personal color schemes. {snapshot.localMode ? 'Saved in this local profile.' : 'Your saved appearance follows your account.'}</p>
    <div className="theme-options">{presets.map(p => <button key={p.id} className="theme-option" aria-pressed={appearance.active === p.id} onClick={() => run('appearance', { ...appearance, active: p.id })}><span className="theme-swatches" aria-hidden="true">{[p.background,p.surface,p.accent].map((c,i)=><i key={i} style={{background:c}}/>)}</span><b>{p.name}</b>{appearance.active === p.id && <Check size={16}/>}</button>)}</div>
    <h3>Custom themes <span className="muted">{appearance.custom.length}/3</span></h3><div className="saved-themes">{appearance.custom.map(t => <div className="saved-theme" key={t.id}><button className="theme-option" aria-pressed={appearance.active === t.id} onClick={() => run('appearance', { ...appearance, active: t.id })}><span className="theme-swatches" aria-hidden="true">{Object.values(t.colors).map((c,i)=><i key={i} style={{background:c}}/>)}</span><b>{t.name}</b>{appearance.active === t.id && <Check size={16}/>}</button><button className="icon-button" aria-label={`Edit theme ${t.name}`} onClick={() => edit(t.id)}><Pencil size={16}/></button><button className="icon-button" aria-label={`Delete theme ${t.name}`} onClick={async () => { if (await run('appearance', { active: appearance.active === t.id ? 'purple' : appearance.active, custom: appearance.custom.filter(c => c.id !== t.id) }, 'Custom theme deleted')) { if(editing===t.id)setEditing(undefined); } }}><Trash2 size={16}/></button></div>)}</div>
    <button className="button secondary" disabled={appearance.custom.length >= 3 || busy} onClick={() => edit(null)}>Create custom theme</button>{appearance.custom.length === 3 && <p className="field-help">All three slots are in use. Edit or delete a saved theme to make room.</p>}
    {editing !== undefined && <form className="theme-editor" onSubmit={e => { e.preventDefault(); void save(); }}><label>Theme name<input required maxLength={32} value={name} onChange={e => setName(e.target.value)}/></label><div className="color-controls">{(['background','surface','accent'] as const).map(key => <label key={key}>{key[0].toUpperCase()+key.slice(1)}<span className="color-input"><input type="color" aria-label={`${key} color picker`} value={/^#[a-f\d]{6}$/i.test(colors[key]) ? colors[key] : '#000000'} onChange={e => setColors({...colors,[key]:e.target.value})}/><input aria-label={`${key} hex color`} maxLength={7} pattern="#[0-9a-fA-F]{6}" required value={colors[key]} onChange={e=>setColors({...colors,[key]:e.target.value})}/></span></label>)}</div>
      <div className="theme-preview" style={{background:colors.background,color:foreground(colors.background)}}><b>Your calendar</b><div style={{background:colors.surface,color:foreground(colors.surface)}}>A little room for your next chapter.<span style={{background:colors.accent,color:foreground(colors.accent)}}>Sample button</span></div></div>{error&&<p role="alert" className="form-error">{error}</p>}<div className="button-row"><button className="button primary" disabled={busy}>Save and apply theme</button><button type="button" className="button secondary" onClick={()=>setEditing(undefined)}>Cancel</button></div></form>}
  </section>;
}
