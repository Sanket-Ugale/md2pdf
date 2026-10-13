"""Secure FastAPI service: upload Markdown, download PDF."""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
import uuid
from collections import defaultdict, deque
from pathlib import Path
from typing import Deque

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import (
    ALLOWED_EXTENSIONS,
    MAX_MARKDOWN_CHARS,
    MAX_UPLOAD_BYTES,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_SECONDS,
    STATIC_DIR,
    TEMP_DIR,
    TEMPLATES_DIR,
)
from app.converter import md_text_to_pdf

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("md-to-pdf")

app = FastAPI(
    title="MD → PDF",
    description="Convert Markdown files to high-fidelity PDFs",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

_SAFE_STEM = re.compile(r"[^A-Za-z0-9._-]+")
_rate_buckets: dict[str, Deque[float]] = defaultdict(deque)
_rate_lock = asyncio.Lock()


class ConvertTextRequest(BaseModel):
    markdown: str
    filename: str | None = "document"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "script-src 'self'; "
            "img-src 'self' data:; "
            "connect-src 'self'; "
            "frame-src 'self' blob:; "
            "object-src 'self' blob:; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        return response


app.add_middleware(SecurityHeadersMiddleware)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _enforce_rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    now = time.monotonic()
    async with _rate_lock:
        bucket = _rate_buckets[ip]
        while bucket and now - bucket[0] > RATE_LIMIT_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= RATE_LIMIT_REQUESTS:
            raise HTTPException(
                status_code=429,
                detail=f"Too many requests. Try again in {RATE_LIMIT_WINDOW_SECONDS}s.",
            )
        bucket.append(now)


def _safe_stem(filename: str | None) -> str:
    name = Path(filename or "document").name
    stem = Path(name).stem
    stem = _SAFE_STEM.sub("_", stem).strip("._") or "document"
    return stem[:80]


def _validate_extension(filename: str | None) -> None:
    if not filename:
        raise HTTPException(status_code=400, detail="Missing filename.")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only .md or .markdown files are accepted.",
        )


def _cleanup_job(job_dir: Path) -> None:
    try:
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)
    except OSError as exc:
        logger.warning("Failed to clean up %s: %s", job_dir, exc)


async def _process_and_convert(md_text: str, filename: str) -> FileResponse:
    if "\x00" in md_text:
        raise HTTPException(status_code=400, detail="Content contains invalid null bytes.")
    if len(md_text) > MAX_MARKDOWN_CHARS:
        raise HTTPException(status_code=413, detail="Markdown content is too long.")

    stem = _safe_stem(filename)
    job_id = uuid.uuid4().hex
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = job_dir / f"{stem}.pdf"

    try:
        await md_text_to_pdf(md_text, job_dir, pdf_path)
    except asyncio.TimeoutError:
        _cleanup_job(job_dir)
        raise HTTPException(status_code=504, detail="Conversion timed out. Try smaller content.") from None
    except Exception:
        logger.exception("Conversion failed for job %s", job_id)
        _cleanup_job(job_dir)
        raise HTTPException(status_code=500, detail="Conversion failed. Please try again.") from None

    if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        _cleanup_job(job_dir)
        raise HTTPException(status_code=500, detail="PDF was not generated.")

    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=f"{stem}.pdf",
        background=BackgroundTask(_cleanup_job, job_dir),
        headers={"Cache-Control": "no-store"},
    )


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/convert")
async def convert(
    request: Request,
    file: UploadFile | None = File(None),
    text: str | None = Form(None),
    filename: str | None = Form(None),
):
    await _enforce_rate_limit(request)
    if file is not None and file.filename:
        _validate_extension(file.filename)

        content_type = (file.content_type or "").lower()
        if content_type and content_type not in {
            "text/markdown",
            "text/x-markdown",
            "text/plain",
            "application/octet-stream",
        }:
            raise HTTPException(status_code=400, detail="Invalid content type for Markdown.")

        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        if not raw.strip():
            raise HTTPException(status_code=400, detail="File is empty.")

        try:
            md_text = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="File must be valid UTF-8 text.") from None

        return await _process_and_convert(md_text, file.filename)

    elif text is not None:
        if not text.strip():
            raise HTTPException(status_code=400, detail="Markdown content is empty.")
        if len(text.encode("utf-8")) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Content too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        target_name = (filename or "").strip() or "document"
        return await _process_and_convert(text, target_name)
    else:
        raise HTTPException(status_code=400, detail="Please upload a file or provide Markdown text.")


@app.post("/api/convert-text")
async def convert_text(request: Request, payload: ConvertTextRequest):
    await _enforce_rate_limit(request)
    if not payload.markdown or not payload.markdown.strip():
        raise HTTPException(status_code=400, detail="Markdown content is empty.")
    if len(payload.markdown.encode("utf-8")) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Content too large. Maximum size is {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    target_name = (payload.filename or "").strip() or "document"
    return await _process_and_convert(payload.markdown, target_name)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
