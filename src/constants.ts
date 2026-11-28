/** Combined YouTube + MP3 library cap. */
export const MAX_LIBRARY_SONGS = 30;

/**
 * Per-file upload limit. Typical album tracks are ~5–15 MB; 25 MB leaves
 * headroom while keeping Postgres BYTEA storage bounded (~30 × 25 MB worst case).
 */
export const MAX_MP3_BYTES = 25 * 1024 * 1024;
export const MAX_MP3_MB = 25;

/**
 * Chunk size for uploads. Publish-app / edge body caps reject ~6 MB single
 * POSTs (bare HTTP 413), so the client sends 512 KB chunks instead.
 */
export const UPLOAD_CHUNK_BYTES = 512 * 1024;

export const LIBRARY_FULL_MESSAGE =
  "Library is full (30 songs). Remove one to add another.";
