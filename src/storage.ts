import type { Prefs, Song, Theme, VisualStyle } from './types';
import { emptyTagSource } from './types';

const SONGS_KEY = 'cuebin.songs.v2';
const SONGS_LEGACY = 'cuebin.songs.v1';
const PREFS_KEY = 'cuebin.prefs.v2';
const PREFS_LEGACY = 'cuebin.prefs.v1';

const DEFAULT_PREFS: Prefs = {
  showVideo: false,
  theme: 'day',
  visualStyle: 'original',
  shuffle: false,
};

function migrateSong(raw: Partial<Song> & { id: string; url: string; title: string }): Song {
  return {
    id: raw.id,
    url: raw.url,
    title: raw.title,
    youtubeId: raw.youtubeId ?? null,
    mood: Array.isArray(raw.mood) ? raw.mood : [],
    type: Array.isArray(raw.type) ? raw.type : [],
    singer: Array.isArray(raw.singer) ? raw.singer : [],
    tagSource: raw.tagSource ?? emptyTagSource(),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

export function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(SONGS_KEY) ?? localStorage.getItem(SONGS_LEGACY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is Partial<Song> & { id: string; url: string; title: string } =>
          Boolean(s && typeof s === 'object' && typeof (s as Song).id === 'string'),
      )
      .map(migrateSong);
  } catch {
    return [];
  }
}

export function saveSongs(songs: Song[]): void {
  localStorage.setItem(SONGS_KEY, JSON.stringify(songs));
}

function asTheme(v: unknown): Theme {
  return v === 'night' ? 'night' : 'day';
}

function asVisualStyle(v: unknown): VisualStyle {
  if (
    v === 'minimal' ||
    v === 'neobrutal' ||
    v === 'persona5' ||
    v === 'original'
  ) {
    return v;
  }
  return 'original';
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(PREFS_LEGACY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      showVideo: Boolean(parsed.showVideo),
      theme: asTheme(parsed.theme),
      visualStyle: asVisualStyle(parsed.visualStyle),
      shuffle: Boolean(parsed.shuffle),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
