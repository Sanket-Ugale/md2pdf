from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
TEMP_DIR = BASE_DIR / "tmp"

# Upload / conversion limits
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_MARKDOWN_CHARS = 2_000_000
ALLOWED_EXTENSIONS = {".md", ".markdown"}
CONVERSION_TIMEOUT_SECONDS = 60
MAX_CONCURRENT_CONVERSIONS = 2

# Simple in-memory rate limit (requests per window per IP)
RATE_LIMIT_REQUESTS = 10
RATE_LIMIT_WINDOW_SECONDS = 60

TEMP_DIR.mkdir(parents=True, exist_ok=True)
