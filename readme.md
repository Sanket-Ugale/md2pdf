# MD → PDF

Convert Markdown to high-fidelity PDF — CLI or web.

## Web app

Upload a `.md` file in the browser and download a styled A4 PDF.

### Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

### Run

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

### Docker

```bash
docker compose up --build
```

App: [http://127.0.0.1:8000](http://127.0.0.1:8000)

### API

`POST /api/convert` — multipart form field `file` (`.md` / `.markdown`, max 5 MB). Returns `application/pdf`.

`GET /health` — liveness check.

### Security notes

- Extension + content-type checks, UTF-8 only, size and length limits
- Rate limiting (10 requests / minute / IP)
- Concurrent conversion cap and timeout
- Temp files removed after download
- Security headers + CSP on responses
- OpenAPI docs disabled in production surface

---

## CLI (`script.py`)

```bash
pip install markdown playwright
playwright install chromium

python script.py input.md
python script.py input.md -o output.pdf
```
