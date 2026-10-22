# Yoinker Playlist CSV Guide

Use this format when asking an AI to generate a playlist for Yoinker.

## Required CSV Header

```csv
order,title,artist,album,source_url,notes
```

## Rules

- Save the file as UTF-8 CSV.
- Put one song per row.
- `title` must be the song name only. Do not include the singer in this field.
- `artist` must be the singer or band. Yoinker requires both `title` and `artist` before it downloads a row.
- `order` controls the download/tag track order. Use plain numbers: `1`, `2`, `3`.
- `album` is optional. If it is blank, Yoinker uses the CSV filename as the album/collection name.
- `source_url` is optional. Add a direct YouTube/Bilibili URL only when it is a known correct source. Otherwise Yoinker searches for `artist - title`.
- `notes` is optional. Use it for `from image`, `artist inferred; verify`, language/version notes, or cleanup reminders.
- Preserve the original language and script from the source unless the user asks you to translate.
- Do not silently invent missing singers. If the source does not show a singer, infer only when you can verify it confidently; otherwise ask for clarification.

## Yoinker Download Location

When Yoinker downloads a playlist CSV, all rows are saved into one playlist folder:

```text
<Music Root>/Playlists/<CSV filename>/01 - <artist> - <title>.mp3
```

For example, `粤语串烧.csv` saves to:

```text
Music/Playlists/粤语串烧/01 - 李克勤 - 月半小夜曲.mp3
```

## Example

```csv
order,title,artist,album,source_url,notes
1,月半小夜曲,李克勤,,,from image
2,一起走过的日子,刘德华,,,from image
3,海阔天空,Beyond,,,from image
```

## Prompt Template

```text
Create a Yoinker playlist CSV from this list/image.
Use exactly this header:
order,title,artist,album,source_url,notes

Rules:
- Every downloadable row must have both title and artist.
- Keep titles and artist names in their original script.
- Do not include numbering in the title.
- If the artist is not visible, verify it before filling it in; otherwise ask me.
- Leave album and source_url blank unless known.
- Add a short note when an artist was inferred.
```
