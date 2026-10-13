"""Markdown → PDF conversion using Playwright (GitHub-flavored styling)."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import markdown
from playwright.async_api import async_playwright

from app.config import CONVERSION_TIMEOUT_SECONDS, MAX_CONCURRENT_CONVERSIONS

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_CONVERSIONS)

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.0/github-markdown.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js"></script>
    <style>
        body {
            box-sizing: border-box;
            min-width: 200px;
            max-width: 980px;
            margin: 0 auto;
            padding: 45px;
        }
        table { width: 100%; }
        img {
            max-width: 100%;
            max-height: 800px;
            object-fit: contain;
            display: block;
            margin: 25px auto;
            border-radius: 6px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .mermaid {
            display: flex;
            justify-content: center;
            align-items: center;
            margin: 24px auto;
            background: transparent;
            text-align: center;
            max-width: 100%;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .mermaid svg {
            max-width: 100% !important;
            max-height: 800px;
            height: auto !important;
            width: auto !important;
        }
        @media print {
            .markdown-body { font-size: 13px; }
            pre, blockquote, table, tr, td, th, img, .mermaid, figure {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }
            h1, h2, h3, h4, h5, h6 {
                page-break-after: avoid;
                break-after: avoid;
            }
            p, li { page-break-inside: avoid; }
            img {
                box-shadow: none;
                border: 1px solid #ddd;
                max-width: 100% !important;
                max-height: 235mm !important; /* Fits single A4 page with margins */
                height: auto !important;
                object-fit: contain;
                page-break-inside: avoid !important;
                break-inside: avoid !important;
            }
            .mermaid {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
                max-width: 100% !important;
                margin: 16px auto;
            }
            .mermaid svg {
                max-width: 100% !important;
                max-height: 235mm !important; /* Ensure tall diagrams fit on a single page */
                height: auto !important;
                width: auto !important;
            }
        }
    </style>
</head>
<body class="markdown-body">
{{content}}
<script>
window.mermaidRenderPromise = (async () => {
    try {
        const blocks = document.querySelectorAll('pre code.language-mermaid, pre.codehilite code.language-mermaid, pre code.mermaid, code.language-mermaid');
        blocks.forEach(code => {
            const container = code.closest('pre') || code;
            const pre = document.createElement('pre');
            pre.className = 'mermaid';
            pre.textContent = code.textContent;
            container.replaceWith(pre);
        });

        const mermaidElements = document.querySelectorAll('.mermaid');
        if (mermaidElements.length > 0 && typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: 'default',
                securityLevel: 'loose',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
            });
            await mermaid.run();
        }
    } catch (err) {
        console.error('Error rendering Mermaid diagram:', err);
    }
})();
</script>
</body>
</html>
"""


def markdown_to_html(md_text: str) -> str:
    html_content = markdown.markdown(
        md_text,
        extensions=["fenced_code", "codehilite", "tables", "sane_lists"],
    )
    return HTML_TEMPLATE.replace("{{content}}", html_content)


async def _render_pdf(html: str, work_dir: Path, pdf_path: Path) -> None:
    temp_html = work_dir / "render.html"
    temp_html.write_text(html, encoding="utf-8")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox"],
        )
        try:
            page = await browser.new_page()
            await page.goto(temp_html.as_uri(), wait_until="networkidle", timeout=30_000)
            await page.evaluate("""async () => {
                if (window.mermaidRenderPromise) {
                    await window.mermaidRenderPromise;
                }
            }""")
            await page.pdf(
                path=str(pdf_path),
                format="A4",
                print_background=True,
                margin={
                    "top": "0.5in",
                    "bottom": "0.5in",
                    "left": "0.5in",
                    "right": "0.5in",
                },
            )
        finally:
            await browser.close()
            if temp_html.exists():
                temp_html.unlink(missing_ok=True)


async def md_text_to_pdf(md_text: str, work_dir: Path, pdf_path: Path) -> None:
    """Convert markdown text to a PDF file under a concurrency + timeout limit."""
    html = markdown_to_html(md_text)
    async with _semaphore:
        await asyncio.wait_for(
            _render_pdf(html, work_dir, pdf_path),
            timeout=CONVERSION_TIMEOUT_SECONDS,
        )


async def md_file_to_pdf(md_path: str | os.PathLike[str], pdf_path: str | os.PathLike[str]) -> None:
    """CLI-compatible helper: convert a markdown file path to a PDF path."""
    md_path = Path(md_path)
    pdf_path = Path(pdf_path)
    work_dir = md_path.parent
    md_text = md_path.read_text(encoding="utf-8")
    await md_text_to_pdf(md_text, work_dir, pdf_path)
