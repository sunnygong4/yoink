/** Lowercase, no spaces or punctuation: for "is X the same name as Y" checks (artists, albums). */
export function flat(s: string | null | undefined): string {
  return (s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** The first credited artist: "Queen & David Bowie" -> "Queen". */
export function leadArtist(artist: string): string {
  return artist.split(/\s*(?:&|,|\/|、| x | feat\.?| ft\.?)\s*/i)[0]
}
