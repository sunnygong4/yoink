/** Lowercase, no spaces or punctuation: for "is X the same name as Y" checks (artists, albums). */
export function flat(s: string | null | undefined): string {
  return (s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** A library song's artist as one name, whatever the song calls them (the server's: 邓丽君 / Teresa Teng -> 鄧麗君). */
export function mainArtist(s: { artist: string; artist_main?: string | null }): string {
  return s.artist_main || leadArtist(s.artist)
}

/** The first credited artist: "Queen & David Bowie" -> "Queen". */
export function leadArtist(artist: string): string {
  return artist.split(/\s*(?:&|,|\/|、| x | feat\.?| ft\.?)\s*/i)[0]
}
