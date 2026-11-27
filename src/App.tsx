import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { autoTagFromMeta, dropTag, mergeManualTag } from './autotag';
import { loadPrefs, loadSongs, savePrefs, saveSongs } from './storage';
import type {
  Filters,
  Song,
  TagField,
  TagSource,
  Theme,
  VisualStyle,
} from './types';
import { emptyTagSource } from './types';
import {
  fetchYoutubeMeta,
  parseYoutubeId,
  postYoutubeCommand,
  titleFromUrl,
  youtubeEmbedUrl,
  youtubeThumb,
} from './youtube';
import './index.css';

const SUGGESTED = {
  mood: ['calm', 'hype', 'melancholy', 'focus', 'late-night', 'rainy'],
  type: ['indie', 'r&b', 'rock', 'lo-fi', 'pop', 'jazz', 'hip-hop', 'acoustic'],
} as const;

const STYLE_OPTIONS: { value: VisualStyle; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'neobrutal', label: 'Neobrutal' },
  { value: 'persona5', label: 'Persona 5' },
];

function uid(): string {
  return crypto.randomUUID();
}

function shuffleIds(ids: string[]): string[] {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

export default function App() {
  const initialPrefs = loadPrefs();
  const [songs, setSongs] = useState<Song[]>(() => loadSongs());
  const [showVideo, setShowVideo] = useState(initialPrefs.showVideo);
  const [theme, setTheme] = useState<Theme>(initialPrefs.theme);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(
    initialPrefs.visualStyle,
  );
  const [shuffle, setShuffle] = useState(initialPrefs.shuffle);
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    mood: null,
    type: null,
    singer: null,
  });
  const [tagsOpen, setTagsOpen] = useState(false);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [booted, setBooted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stylePickerRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<Song[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const embedOrigin =
    typeof window !== 'undefined' ? window.location.origin : undefined;

  useEffect(() => {
    const t = requestAnimationFrame(() => setBooted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    saveSongs(songs);
  }, [songs]);

  const themeLocked =
    visualStyle === 'neobrutal' || visualStyle === 'persona5';
  const effectiveTheme: Theme = themeLocked ? 'day' : theme;

  useEffect(() => {
    if (themeLocked && theme !== 'day') {
      setTheme('day');
    }
  }, [themeLocked, theme]);

  useEffect(() => {
    savePrefs({ showVideo, theme: effectiveTheme, visualStyle, shuffle });
  }, [showVideo, effectiveTheme, visualStyle, shuffle]);

  useEffect(() => {
    if (!styleMenuOpen) return;
    function onPointerDown(e: MouseEvent) {
      const root = stylePickerRef.current;
      if (root && !root.contains(e.target as Node)) {
        setStyleMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setStyleMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [styleMenuOpen]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = effectiveTheme;
    root.dataset.style = visualStyle;
    delete root.dataset.listen;
    root.style.colorScheme =
      effectiveTheme === 'night' ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const colors: Record<VisualStyle, { day: string; night: string }> = {
        original: { day: '#D5E2EA', night: '#161B20' },
        minimal: { day: '#F7F7F5', night: '#121212' },
        neobrutal: { day: '#FFE566', night: '#FFE566' },
        persona5: { day: '#0A0A0A', night: '#0A0A0A' },
      };
      meta.setAttribute(
        'content',
        effectiveTheme === 'night'
          ? colors[visualStyle].night
          : colors[visualStyle].day,
      );
    }
  }, [effectiveTheme, visualStyle]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (activeId && !songs.some((s) => s.id === activeId)) {
      setActiveId(null);
    }
  }, [songs, activeId]);

  const active = songs.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    // New track → autoplay embed; reset local play state.
    setIsPlaying(Boolean(active?.youtubeId));
  }, [active?.id, active?.youtubeId]);

  /** Playlist always loops: advance or wrap to first. */
  const advanceFromEnd = useCallback(() => {
    const q = queueRef.current;
    const id = activeIdRef.current;
    const idx = id ? q.findIndex((s) => s.id === id) : -1;
    if (q.length === 0) {
      setIsPlaying(false);
      return;
    }
    // Orphan active (e.g. filtered out) → land on first of visible queue
    if (idx < 0) {
      setActiveId(q[0].id);
      setTagsOpen(false);
      return;
    }
    const next = idx < q.length - 1 ? q[idx + 1] : q[0];
    setActiveId(next.id);
    setTagsOpen(false);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (typeof event.origin !== 'string' || !event.origin.includes('youtube')) {
        return;
      }
      let data: unknown = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== 'object') return;
      const payload = data as {
        event?: string;
        info?: number | { playerState?: number };
      };
      if (payload.event !== 'infoDelivery' && payload.event !== 'onStateChange') {
        return;
      }
      const state =
        typeof payload.info === 'number'
          ? payload.info
          : payload.info && typeof payload.info === 'object'
            ? payload.info.playerState
            : undefined;
      // 1 playing, 2 paused, 0 ended
      if (state === 1) setIsPlaying(true);
      else if (state === 2) setIsPlaying(false);
      else if (state === 0) advanceFromEnd();
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [advanceFromEnd]);

  const tagIndex = useMemo(() => {
    const mood = new Set<string>();
    const type = new Set<string>();
    const singer = new Set<string>();
    for (const s of songs) {
      s.mood.forEach((t) => mood.add(t));
      s.type.forEach((t) => type.add(t));
      s.singer.forEach((t) => singer.add(t));
    }
    return {
      mood: [...mood].sort(),
      type: [...type].sort(),
      singer: [...singer].sort(),
    };
  }, [songs]);

  const filtered = useMemo(() => {
    return songs.filter((s) => {
      if (filters.mood && !s.mood.includes(filters.mood)) return false;
      if (filters.type && !s.type.includes(filters.type)) return false;
      if (filters.singer && !s.singer.includes(filters.singer)) return false;
      return true;
    });
  }, [songs, filters]);

  const filtersActive = Boolean(filters.mood || filters.type || filters.singer);

  /** Keep shuffle order in sync with the current filtered set. */
  useEffect(() => {
    if (!shuffle) return;
    const ids = filtered.map((s) => s.id);
    setShuffleOrder((prev) => {
      if (ids.length === 0) return prev.length === 0 ? prev : [];
      const keep = prev.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !keep.includes(id));
      if (keep.length === 0) return shuffleIds(ids);
      if (added.length === 0 && keep.length === prev.length) return prev;
      return [...keep, ...shuffleIds(added)];
    });
  }, [filtered, shuffle]);

  /** Playback queue: shuffled filtered order when shuffle is on; else list order. Always loops. */
  const queue = useMemo(() => {
    if (!shuffle || shuffleOrder.length === 0) return filtered;
    const byId = new Map(filtered.map((s) => [s.id, s]));
    const ordered: Song[] = [];
    for (const id of shuffleOrder) {
      const song = byId.get(id);
      if (song) ordered.push(song);
    }
    for (const song of filtered) {
      if (!shuffleOrder.includes(song.id)) ordered.push(song);
    }
    return ordered;
  }, [filtered, shuffle, shuffleOrder]);

  /** If filters exclude the active track, move into the visible queue. */
  useEffect(() => {
    if (!activeId || filtered.length === 0) return;
    if (filtered.some((s) => s.id === activeId)) return;
    setActiveId(filtered[0].id);
    setTagsOpen(false);
  }, [filtered, activeId]);

  useEffect(() => {
    if (shuffle && filtered.length < 2) {
      setShuffle(false);
    }
  }, [filtered.length, shuffle]);

  const queueIndex = activeId
    ? queue.findIndex((s) => s.id === activeId)
    : -1;
  /** Visible queue nonempty → prev/next can enter or step (always loops). */
  const canStep = queue.length > 0;

  queueRef.current = queue;
  activeIdRef.current = activeId;

  const playActive = useCallback(() => {
    postYoutubeCommand(iframeRef.current, 'playVideo');
    setIsPlaying(true);
  }, []);

  const pauseActive = useCallback(() => {
    postYoutubeCommand(iframeRef.current, 'pauseVideo');
    setIsPlaying(false);
  }, []);

  function togglePlayPause() {
    if (!active?.youtubeId) return;
    if (isPlaying) pauseActive();
    else playActive();
  }

  function goPrev() {
    if (!canStep) return;
    if (queueIndex < 0) {
      setActiveId(queue[queue.length - 1].id);
      setTagsOpen(false);
      return;
    }
    const target =
      queueIndex > 0 ? queue[queueIndex - 1] : queue[queue.length - 1];
    setActiveId(target.id);
    setTagsOpen(false);
  }

  function goNext() {
    if (!canStep) return;
    if (queueIndex < 0) {
      setActiveId(queue[0].id);
      setTagsOpen(false);
      return;
    }
    const target =
      queueIndex < queue.length - 1 ? queue[queueIndex + 1] : queue[0];
    setActiveId(target.id);
    setTagsOpen(false);
  }

  function toggleShuffle() {
    if (filtered.length < 2) return;
    setShuffle((on) => {
      if (!on) {
        setShuffleOrder(shuffleIds(filtered.map((s) => s.id)));
      }
      return !on;
    });
  }

  function armYoutubeListening() {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: 'listening', id: 1 }),
      '*',
    );
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const raw = urlInput.trim();
    if (!raw) return;

    const youtubeId = parseYoutubeId(raw);
    const id = uid();
    const provisional: Song = {
      id,
      url: raw.includes('://') ? raw : `https://${raw}`,
      title: titleFromUrl(raw, youtubeId),
      youtubeId,
      mood: [],
      type: [],
      singer: [],
      tagSource: emptyTagSource(),
      createdAt: Date.now(),
    };

    setSongs((prev) => [provisional, ...prev]);
    setUrlInput('');
    setActiveId(id);
    setTagsOpen(true);

    if (!youtubeId) {
      setNotice('Saved — Cuebin can’t play this link yet. Only YouTube plays in-app.');
      return;
    }

    setNotice(null);
    const meta = await fetchYoutubeMeta(youtubeId);
    const title = meta.title ?? provisional.title;
    const tags = autoTagFromMeta(title, meta.authorName);
    setSongs((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              title,
              mood: tags.mood,
              type: tags.type,
              singer: tags.singer,
              tagSource: tags.tagSource,
            }
          : s,
      ),
    );
    const n = tags.mood.length + tags.type.length + tags.singer.length;
    if (n > 0) {
      setNotice(`Auto-tagged ${n} label${n === 1 ? '' : 's'} — edit anytime.`);
    }
  }

  function updateSong(id: string, patch: Partial<Song>) {
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function removeSong(id: string, title: string) {
    if (!window.confirm(`Remove “${title}” from Cuebin?`)) return;
    setSongs((prev) => prev.filter((s) => s.id !== id));
  }

  function addTag(songId: string, field: TagField, value: string) {
    setSongs((prev) =>
      prev.map((s) => {
        if (s.id !== songId) return s;
        return { ...s, ...mergeManualTag(s, field, value) };
      }),
    );
  }

  function removeTag(songId: string, field: TagField, tag: string) {
    setSongs((prev) =>
      prev.map((s) => {
        if (s.id !== songId) return s;
        return { ...s, ...dropTag(s, field, tag) };
      }),
    );
  }

  function clearFilters() {
    setFilters({ mood: null, type: null, singer: null });
  }

  function toggleTheme() {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const canTransition =
      !reduceMotion &&
      typeof document !== 'undefined' &&
      'startViewTransition' in document;

    if (canTransition) {
      (
        document as Document & {
          startViewTransition: (cb: () => void) => void;
        }
      ).startViewTransition(() => {
        flushSync(() => setTheme(next));
      });
      return;
    }

    setTheme(next);
  }

  return (
    <div
      className={`app ${booted ? 'is-booted' : ''} ${showVideo ? 'mode-video' : 'mode-work'}`}
      data-theme={effectiveTheme}
      data-style={visualStyle}
    >
      <a className="skip-link" href="#main-stage">
        Skip to player
      </a>
      <div className="atmosphere" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-block">
          <h1 className="brand" translate="no">
            Cuebin
          </h1>
          <p className="tagline">
            Listen at your desk. Stay in the flow.
          </p>
        </div>
        <div className="header-controls">
          <div className="style-picker" ref={stylePickerRef}>
            <span className="style-picker-label" id="style-picker-label">
              Style
            </span>
            <button
              type="button"
              className="style-picker-trigger"
              aria-labelledby="style-picker-label"
              aria-haspopup="listbox"
              aria-expanded={styleMenuOpen}
              aria-controls="style-picker-menu"
              onClick={() => setStyleMenuOpen((o) => !o)}
            >
              {STYLE_OPTIONS.find((o) => o.value === visualStyle)?.label ??
                'Original'}
            </button>
            {styleMenuOpen ? (
              <ul
                id="style-picker-menu"
                className="style-picker-menu"
                role="listbox"
                aria-labelledby="style-picker-label"
              >
                {STYLE_OPTIONS.map((opt) => {
                  const selected = opt.value === visualStyle;
                  return (
                    <li key={opt.value} role="presentation">
                      <button
                        type="button"
                        role="option"
                        className="style-picker-option"
                        aria-selected={selected}
                        onClick={() => {
                          setVisualStyle(opt.value);
                          setStyleMenuOpen(false);
                        }}
                      >
                        <span>{opt.label}</span>
                        <span
                          className="style-picker-check"
                          aria-hidden="true"
                        >
                          {selected ? '✓' : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          {!themeLocked && (
            <div className="theme-switch">
              <span className="theme-switch-label" id="theme-day-label">
                Day
              </span>
              <button
                type="button"
                role="switch"
                className="theme-switch-track"
                aria-checked={theme === 'night'}
                aria-labelledby="theme-day-label theme-night-label"
                onClick={toggleTheme}
              >
                <span className="theme-switch-thumb" aria-hidden="true" />
              </button>
              <span className="theme-switch-label" id="theme-night-label">
                Night
              </span>
            </div>
          )}
        </div>
      </header>

      <form className="paste" onSubmit={handleAdd}>
        <label htmlFor="song-url" className="sr-only">
          Song link
        </label>
        <input
          id="song-url"
          name="song-url"
          type="url"
          inputMode="url"
          placeholder="Paste a YouTube link…"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn-primary" disabled={!urlInput.trim()}>
          Add
        </button>
      </form>

      <div aria-live="polite" aria-atomic="true">
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
      </div>

      <section className="filters glass-panel" aria-label="Filters">
        <FilterRow
          label="Mood"
          options={tagIndex.mood}
          value={filters.mood}
          onChange={(v) => setFilters((f) => ({ ...f, mood: v }))}
        />
        <FilterRow
          label="Type"
          options={tagIndex.type}
          value={filters.type}
          onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
        />
        <FilterRow
          label="Singer"
          options={tagIndex.singer}
          value={filters.singer}
          onChange={(v) => setFilters((f) => ({ ...f, singer: v }))}
        />
        <button
          type="button"
          className="clear-filters"
          onClick={clearFilters}
          disabled={!filtersActive}
        >
          Clear Filters
        </button>
      </section>

      <main className="stage" id="main-stage">
        <aside
          className={`player-pane glass-panel ${active ? 'has-track' : ''} ${showVideo ? 'is-stage' : 'is-tray'}`}
          aria-label="Now playing"
        >
          <div className="player-chrome">
            <p className="player-chrome-label">Now playing</p>
            <div className="transport" role="group" aria-label="Playback controls">
              <button
                type="button"
                className="transport-btn"
                aria-label="Previous song"
                disabled={!canStep}
                onClick={goPrev}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="transport-btn transport-btn-play"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                disabled={!active?.youtubeId}
                onClick={togglePlayPause}
              >
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path fill="currentColor" d="M8 5v14l11-7L8 5z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="transport-btn"
                aria-label="Next song"
                disabled={!canStep}
                onClick={goNext}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M16 6h2v12h-2V6zM6 18l8.5-6L6 6v12z"
                  />
                </svg>
              </button>
              <button
                type="button"
                className={`transport-btn transport-btn-shuffle ${shuffle ? 'is-on' : ''}`}
                aria-label="Shuffle"
                aria-pressed={shuffle}
                disabled={filtered.length < 2}
                title={
                  shuffle
                    ? 'Shuffle on — next uses shuffled order'
                    : 'Shuffle off — next uses list order'
                }
                onClick={toggleShuffle}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"
                  />
                </svg>
              </button>
            </div>
            <button
              type="button"
              className={`video-toggle ${showVideo ? 'is-on' : 'is-off'}`}
              aria-pressed={showVideo}
              aria-label={
                showVideo
                  ? 'Hide video and keep audio playing'
                  : 'Show video while playing'
              }
              onClick={() => setShowVideo((v) => !v)}
            >
              {showVideo ? 'Hide video' : 'Show video'}
            </button>
          </div>

          {active ? (
            <>
              {active.youtubeId ? (
                <>
                  <div
                    className={`player-stage ${showVideo ? 'is-open' : 'is-closed'}`}
                  >
                    <div className="player-stage-inner">
                      <div
                        className={`player-frame ${showVideo ? 'is-visible' : 'is-audio-only'}`}
                        aria-hidden={!showVideo}
                      >
                        <iframe
                          key={active.youtubeId}
                          ref={iframeRef}
                          title={`Play ${active.title}`}
                          src={youtubeEmbedUrl(active.youtubeId, embedOrigin)}
                          referrerPolicy="strict-origin-when-cross-origin"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          onLoad={armYoutubeListening}
                        />
                      </div>
                      <p
                        className={`stage-caption ${showVideo ? 'is-shown' : 'is-hidden'}`}
                      >
                        <span className="now-title">{active.title}</span>
                        {active.singer[0] ? (
                          <span className="song-sub"> · {active.singer[0]}</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <div
                    className={`now-playing-slot ${showVideo ? 'is-closed' : 'is-open'}`}
                  >
                    <div className="now-playing-slot-inner">
                      <div className="now-playing glass-inset">
                        <img
                          src={youtubeThumb(active.youtubeId)}
                          alt=""
                          width={54}
                          height={54}
                          className="now-art"
                        />
                        <div className="now-copy">
                          <p className="now-label">Listening</p>
                          <p className="now-title">{active.title}</p>
                          <p className="now-hint">
                            Video hidden · audio keeps playing
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="player-unsupported">
                  <p>Can’t play this link yet.</p>
                  <a href={active.url} target="_blank" rel="noreferrer">
                    Open original
                  </a>
                </div>
              )}

              <div className="player-tools">
                <button
                  type="button"
                  className="tags-disclosure"
                  aria-expanded={tagsOpen}
                  aria-label={`Tags, ${active.mood.length + active.type.length + active.singer.length}`}
                  onClick={() => setTagsOpen((o) => !o)}
                >
                  Tags
                  <span className="tags-count">
                    {active.mood.length + active.type.length + active.singer.length}
                  </span>
                  <span aria-hidden="true">{tagsOpen ? '▴' : '▾'}</span>
                </button>

                {tagsOpen && (
                  <div className="editor">
                    <label className="field" htmlFor="song-title">
                      <span>Title</span>
                      <input
                        id="song-title"
                        name="song-title"
                        value={active.title}
                        onChange={(e) =>
                          updateSong(active.id, { title: e.target.value })
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <TagEditor
                      label="Mood"
                      field="mood"
                      tags={active.mood}
                      sources={active.tagSource.mood}
                      suggestions={SUGGESTED.mood}
                      onAdd={(t) => addTag(active.id, 'mood', t)}
                      onRemove={(t) => removeTag(active.id, 'mood', t)}
                    />
                    <TagEditor
                      label="Type"
                      field="type"
                      tags={active.type}
                      sources={active.tagSource.type}
                      suggestions={SUGGESTED.type}
                      onAdd={(t) => addTag(active.id, 'type', t)}
                      onRemove={(t) => removeTag(active.id, 'type', t)}
                    />
                    <TagEditor
                      label="Singer"
                      field="singer"
                      tags={active.singer}
                      sources={active.tagSource.singer}
                      suggestions={[]}
                      onAdd={(t) => addTag(active.id, 'singer', t)}
                      onRemove={(t) => removeTag(active.id, 'singer', t)}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="player-idle">
              <p>Pick a song to listen.</p>
            </div>
          )}
        </aside>

        <div className="list-pane">
          <div className="list-head" id="song-list" tabIndex={-1}>
            <span>
              {filtersActive
                ? `${filtered.length} of ${songs.length}`
                : `${songs.length} song${songs.length === 1 ? '' : 's'}`}
            </span>
            <span className="list-head-muted">on this device</span>
          </div>

          {songs.length === 0 ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <p className="empty-filtered">
              Nothing matches.{' '}
              <button type="button" className="text-btn" onClick={clearFilters}>
                Clear filters
              </button>
            </p>
          ) : (
            <ul className="song-list">
              {filtered.map((song) => (
                <li
                  key={song.id}
                  className={`song-row ${activeId === song.id ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="song-main"
                    onClick={() => {
                      setActiveId(song.id);
                      setTagsOpen(false);
                    }}
                  >
                    <span className="thumb">
                      {song.youtubeId ? (
                        <img
                          src={youtubeThumb(song.youtubeId)}
                          alt=""
                          width={43}
                          height={43}
                          loading="lazy"
                        />
                      ) : (
                        <span className="thumb-fallback" aria-hidden="true" />
                      )}
                    </span>
                    <span className="song-meta">
                      <span className="song-title">{song.title}</span>
                      <span className="song-sub">
                        {song.youtubeId ? (
                          song.singer[0] ?? 'YouTube'
                        ) : (
                          <span className="cant-play">Saved · can’t play yet</span>
                        )}
                      </span>
                      {(song.mood.length > 0 || song.type.length > 0) && (
                        <span className="tag-preview">
                          {[...song.mood, ...song.type].slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className={`mini-tag ${
                                song.tagSource.mood[t] === 'auto' ||
                                song.tagSource.type[t] === 'auto'
                                  ? 'is-auto'
                                  : ''
                              }`}
                            >
                              {t}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${song.title}`}
                    onClick={() => removeSong(song.id, song.title)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <p className="empty-lead">Nothing here yet</p>
      <p className="empty-hint">
        Paste a YouTube link. Cuebin auto-tags mood, type, and singer so you can
        filter while you work.
      </p>
    </div>
  );
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="filter-row">
      <span className="filter-label">{label}</span>
      <div className="filter-chips" role="group" aria-label={label}>
        {options.map((opt) => {
          const on = value === opt;
          return (
            <button
              key={opt}
              type="button"
              className={`chip ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(on ? null : opt)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagEditor({
  label,
  field,
  tags,
  sources,
  suggestions,
  onAdd,
  onRemove,
}: {
  label: string;
  field: TagField;
  tags: string[];
  sources: Record<string, TagSource>;
  suggestions: readonly string[];
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const unused = suggestions.filter((s) => !tags.includes(s));
  const inputId = `tag-${field}`;

  function submit(e: FormEvent) {
    e.preventDefault();
    onAdd(draft);
    setDraft('');
  }

  return (
    <div className="tag-editor" data-field={field}>
      <div className="tag-editor-head">
        <label htmlFor={inputId}>{label}</label>
      </div>
      <div className="tag-list">
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className={`chip is-on ${sources[t] === 'auto' ? 'is-auto' : ''}`}
            onClick={() => onRemove(t)}
            aria-label={
              sources[t] === 'auto'
                ? `Remove auto-tagged ${t}`
                : `Remove ${t}`
            }
          >
            {t}
            {sources[t] === 'auto' && (
              <span className="auto-mark" aria-hidden="true">
                auto
              </span>
            )}
            <span aria-hidden="true"> ×</span>
          </button>
        ))}
      </div>
      <form className="tag-add" onSubmit={submit}>
        <input
          id={inputId}
          name={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add ${label.toLowerCase()}…`}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" disabled={!draft.trim()} aria-label={`Add ${label}`}>
          +
        </button>
      </form>
      {unused.length > 0 && (
        <div className="suggest">
          {unused.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              className="chip ghost"
              onClick={() => onAdd(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
