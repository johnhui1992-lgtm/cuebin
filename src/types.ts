export type TagSource = 'auto' | 'manual';

export type Song = {
  id: string;
  url: string;
  title: string;
  youtubeId: string | null;
  mood: string[];
  type: string[];
  singer: string[];
  /** Per-field map of tag → how it was set */
  tagSource: {
    mood: Record<string, TagSource>;
    type: Record<string, TagSource>;
    singer: Record<string, TagSource>;
  };
  createdAt: number;
};

export type TagField = 'mood' | 'type' | 'singer';

export type Filters = {
  mood: string | null;
  type: string | null;
  singer: string | null;
};

export type Theme = 'day' | 'night';

/** Visual chrome skins — Original is glass Cuebin; others follow Tilda mocks. */
export type VisualStyle = 'original' | 'minimal' | 'neobrutal' | 'persona5';

export type Prefs = {
  /** When false, video is hidden for audio-only / work listening */
  showVideo: boolean;
  theme: Theme;
  visualStyle: VisualStyle;
  /** Shuffle play order of the current filtered list */
  shuffle: boolean;
};

export function emptyTagSource(): Song['tagSource'] {
  return { mood: {}, type: {}, singer: {} };
}
