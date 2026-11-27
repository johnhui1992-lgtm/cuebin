import type { Song, TagField, TagSource } from './types';
import { emptyTagSource } from './types';

const TYPE_RULES: { tag: string; re: RegExp }[] = [
  { tag: 'lo-fi', re: /\b(lo[\s-]?fi|lofibeats|chillhop)\b/i },
  { tag: 'jazz', re: /\bjazz\b/i },
  { tag: 'rock', re: /\b(rock|indie rock|alt rock)\b/i },
  { tag: 'r&b', re: /\b(r&b|rnb|rhythm and blues)\b/i },
  { tag: 'indie', re: /\bindie\b/i },
  { tag: 'pop', re: /\b(pop|k-?pop|synth[\s-]?pop)\b/i },
  { tag: 'hip-hop', re: /\b(hip[\s-]?hop|rap)\b/i },
  { tag: 'edm', re: /\b(edm|electronic|house|techno|trance)\b/i },
  { tag: 'classical', re: /\b(classical|orchestra|piano concerto)\b/i },
  { tag: 'acoustic', re: /\bacoustic\b/i },
  { tag: 'metal', re: /\b(metal|hardcore)\b/i },
  { tag: 'folk', re: /\bfolk\b/i },
  { tag: 'soul', re: /\bsoul\b/i },
];

const MOOD_RULES: { tag: string; re: RegExp }[] = [
  { tag: 'focus', re: /\b(focus|study|studying|deep work|concentration|productive)\b/i },
  { tag: 'calm', re: /\b(calm|chill|relax|peaceful|ambient|soft|gentle)\b/i },
  { tag: 'melancholy', re: /\b(sad|melancholy|heartbreak|lonely|blue)\b/i },
  { tag: 'hype', re: /\b(hype|party|banger|workout|energy|pump|dance)\b/i },
  { tag: 'late-night', re: /\b(late[\s-]?night|midnight|night drive|nocturnal|insomnia)\b/i },
  { tag: 'rainy', re: /\b(rain|rainy|storm)\b/i },
];

function normalize(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pushUnique(
  list: string[],
  sources: Record<string, TagSource>,
  value: string,
  source: TagSource,
) {
  const tag = normalize(value);
  if (!tag || list.includes(tag)) return;
  list.push(tag);
  sources[tag] = source;
}

/** Pull artist from common title shapes; prefer oEmbed author when useful. */
export function inferSinger(title: string, authorName?: string | null): string[] {
  const out: string[] = [];
  const cleanAuthor = authorName
    ?.replace(/\s*(-?\s*Topic|VEVO|Official|Music)$/i, '')
    .trim();

  const patterns = [
    /^(.+?)\s+[–—-]\s+(.+)$/, // Artist - Title
    /^(.+?)\s*:\s+(.+)$/, // Artist: Title
    /^(.+?)\s+by\s+(.+)$/i, // Title by Artist (capture group 2)
  ];

  for (const re of patterns) {
    const m = title.match(re);
    if (!m) continue;
    if (re.source.includes('by')) {
      const artist = m[2]?.replace(/\s*[(\[].*$/, '').trim();
      if (artist && artist.length < 60) out.push(artist);
    } else {
      const artist = m[1]?.replace(/\s*[(\[].*$/, '').trim();
      // Avoid treating long descriptive phrases as artists
      if (artist && artist.length > 1 && artist.length < 48 && !/\bofficial\b/i.test(artist)) {
        out.push(artist);
      }
    }
    break;
  }

  if (cleanAuthor && cleanAuthor.length > 1 && cleanAuthor.length < 48) {
    const lower = normalize(cleanAuthor);
    if (!out.some((a) => normalize(a) === lower)) {
      // Prefer channel when title had no artist parse
      if (out.length === 0) out.push(cleanAuthor);
    }
  }

  return out.map(normalize).filter(Boolean);
}

export function inferType(haystack: string): string[] {
  return TYPE_RULES.filter((r) => r.re.test(haystack)).map((r) => r.tag);
}

export function inferMood(haystack: string): string[] {
  const found = MOOD_RULES.filter((r) => r.re.test(haystack)).map((r) => r.tag);
  // Soft defaults when lo-fi / study shows up without explicit mood
  if (/\blo[\s-]?fi\b|\bstudy\b/i.test(haystack) && !found.includes('focus') && !found.includes('calm')) {
    found.push('focus');
  }
  return found;
}

export type AutoTagResult = {
  mood: string[];
  type: string[];
  singer: string[];
  tagSource: Song['tagSource'];
};

export function autoTagFromMeta(
  title: string,
  authorName?: string | null,
): AutoTagResult {
  const tagSource = emptyTagSource();
  const mood: string[] = [];
  const type: string[] = [];
  const singer: string[] = [];
  const hay = `${title} ${authorName ?? ''}`;

  for (const t of inferMood(hay)) pushUnique(mood, tagSource.mood, t, 'auto');
  for (const t of inferType(hay)) pushUnique(type, tagSource.type, t, 'auto');
  for (const t of inferSinger(title, authorName)) {
    pushUnique(singer, tagSource.singer, t, 'auto');
  }

  return { mood, type, singer, tagSource };
}

export function mergeManualTag(
  song: Song,
  field: TagField,
  value: string,
): Pick<Song, TagField | 'tagSource'> {
  const tag = normalize(value);
  const list = [...song[field]];
  const tagSource = {
    mood: { ...song.tagSource.mood },
    type: { ...song.tagSource.type },
    singer: { ...song.tagSource.singer },
  };
  if (tag && !list.includes(tag)) {
    list.push(tag);
    tagSource[field][tag] = 'manual';
  }
  return { [field]: list, tagSource } as Pick<Song, TagField | 'tagSource'>;
}

export function dropTag(
  song: Song,
  field: TagField,
  value: string,
): Pick<Song, TagField | 'tagSource'> {
  const tagSource = {
    mood: { ...song.tagSource.mood },
    type: { ...song.tagSource.type },
    singer: { ...song.tagSource.singer },
  };
  delete tagSource[field][value];
  return {
    [field]: song[field].filter((t) => t !== value),
    tagSource,
  } as Pick<Song, TagField | 'tagSource'>;
}
