import mimetypes
from pathlib import Path
from urllib.parse import quote

import requests
from fastapi import HTTPException, Request, status
from fastapi.responses import StreamingResponse


CHUNK_SIZE = 1024 * 256


def guess_media_type(file_path: Path) -> str:
    media_type, _ = mimetypes.guess_type(file_path.name)
    return media_type or "application/octet-stream"


def _content_disposition(disposition: str, filename: str) -> str:
    ascii_filename = "".join(char if 32 <= ord(char) < 127 and char not in {'"', "\\"} else "_" for char in filename)
    ascii_filename = ascii_filename.strip(" .") or "download"
    encoded_filename = quote(filename, safe="")
    return f"{disposition}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_filename}"


def _iter_file_range(file_path: Path, start: int, end: int):
    remaining = end - start + 1
    with file_path.open("rb") as handle:
        handle.seek(start)
        while remaining > 0:
            chunk = handle.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def build_stream_response(file_path: Path, request: Request, *, disposition: str = "inline"):
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Stored file missing on disk")

    media_type = guess_media_type(file_path)
    file_size = file_path.stat().st_size
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": _content_disposition(disposition, file_path.name),
    }

    range_header = request.headers.get("range")
    if not range_header:
        headers["Content-Length"] = str(file_size)
        return StreamingResponse(
            _iter_file_range(file_path, 0, max(file_size - 1, 0)),
            media_type=media_type,
            headers=headers,
        )

    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range")

    byte_range = range_header.replace("bytes=", "", 1).split(",", 1)[0].strip()
    start_text, _, end_text = byte_range.partition("-")
    if not start_text and not end_text:
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range")

    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        else:
            suffix_length = int(end_text)
            if suffix_length <= 0:
                raise ValueError("suffix range must be positive")
            start = max(file_size - suffix_length, 0)
            end = file_size - 1
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Invalid range",
            headers={"Content-Range": f"bytes */{file_size}"},
        ) from exc

    if start < 0 or end < 0 or start >= file_size or end >= file_size or start > end:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail="Requested range not satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    content_length = end - start + 1
    headers.update(
        {
            "Content-Length": str(content_length),
            "Content-Range": f"bytes {start}-{end}/{file_size}",
        }
    )
    return StreamingResponse(
        _iter_file_range(file_path, start, end),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type=media_type,
        headers=headers,
    )


def _iter_remote_response(response: requests.Response):
    try:
        for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
            if chunk:
                yield chunk
    finally:
        response.close()


def build_remote_stream_response(
    *,
    source_url: str,
    request: Request,
    upstream_headers: dict[str, str] | None = None,
    media_type: str | None = None,
    disposition: str = "inline",
):
    headers = {"Accept-Ranges": "bytes"}
    if disposition:
        headers["Content-Disposition"] = disposition

    request_headers = dict(upstream_headers or {})
    if request.headers.get("range"):
        request_headers["Range"] = request.headers["range"]

    try:
        response = requests.get(
            source_url,
            headers=request_headers,
            stream=True,
            timeout=30,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Could not open discovery stream") from exc

    if response.status_code >= 400:
        response.close()
        raise HTTPException(status_code=502, detail="Discovery stream upstream error")

    passthrough_headers = ("Content-Length", "Content-Range", "Accept-Ranges")
    for header_name in passthrough_headers:
        if response.headers.get(header_name):
            headers[header_name] = response.headers[header_name]

    return StreamingResponse(
        _iter_remote_response(response),
        status_code=response.status_code,
        media_type=media_type or response.headers.get("Content-Type") or "audio/*",
        headers=headers,
    )
