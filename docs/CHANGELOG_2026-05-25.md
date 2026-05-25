# Changes — 25 May 2026

## Telegram File I/O

### Send Files to User (`telegram_send_file`)
- Agent can upload and send files to the user via Telegram's `sendDocument` API
- Supports any file up to 50MB (Telegram limit)
- Tool has `riskLevel: medium` — requires user permission before sending
- Only active in daemon mode (Telegram bridge must be running)

### Receive Files from User
- Bridge now detects incoming file messages: documents, photos, audio, video, voice notes
- Downloads file from Telegram servers via `getFile` API (up to 20MB)
- Saves to `~/.local/share/agentx/files/{timestamp}_{filename}`
- Informs the agent with file path, MIME type, and caption for analysis
- Supported in: `TelegramBridge.setFileHandler()`

---

## Document Readers (Zero Dependencies)

All readers work without external dependencies — uses Node.js built-in `zlib` and a custom ZIP parser.

| Tool | Format | Description |
|------|--------|-------------|
| `pdf_read` | PDF | Extracts text from PDF streams (FlateDecode + raw). Handles Tj/TJ operators |
| `docx_read` | Word (.docx) | Parses OOXML ZIP, extracts `<w:t>` text nodes |
| `xlsx_read` | Excel (.xlsx) | Parses shared strings + sheet data, returns tab-separated values |
| `pptx_read` | PowerPoint (.pptx) | Extracts `<a:t>` DrawingML text from each slide |

### Limitations
- PDF: Image-based/scanned PDFs return "(no extractable text)"
- XLSX: Formulas return computed values only if cached; no formula evaluation
- All readers truncate output at 100K characters to avoid context overflow

---

## Image OCR (`image_ocr`)

- Extracts text from images using Tesseract OCR
- Supports: PNG, JPG, JPEG, GIF, WEBP, BMP, TIFF
- Requires `tesseract` CLI installed on the system
- Gracefully fails with install instructions if Tesseract is missing

---

## Timezone Support

### Config
- New field: `config.timezone` (IANA format, e.g., `Asia/Kolkata`)
- Auto-detected from system on first setup and config load
- Persisted to config file

### Agent Awareness
- `[CURRENT_TIME]` block in system prompt shows:
  - ISO timestamp
  - User's configured timezone
  - Local time in that timezone
  - UTC offset (e.g., `+05:30`)

### Telegram Commands
- `/timezone` or `/tz` — view current timezone
- `/timezone Asia/Kolkata` — set timezone (validates IANA format)

---

## Scheduler: `at_time` Parameter

- New parameter on `reminder_set`: `at_time` (ISO 8601 with timezone)
- Allows absolute time scheduling: "remind me at 5pm" → `2026-05-25T17:00:00+05:30`
- Computes delay from current time, rejects past times
- Works correctly regardless of server timezone (uses config timezone)

---

## Install Scripts Updated

### Tesseract OCR Auto-Install
Added as an optional step during Agent-X installation:

| Platform | Method |
|----------|--------|
| macOS | `brew install tesseract` |
| Ubuntu/Debian | `sudo apt-get install -y tesseract-ocr` |
| Fedora | `sudo dnf install -y tesseract` |
| Arch | `sudo pacman -S --noconfirm tesseract` |
| Windows (choco) | `choco install tesseract` |
| Windows (winget) | `winget install UB-Mannheim.TesseractOCR` |

Non-blocking: if auto-install fails, shows a warning with manual instructions.

---

## CI/CD

- Strict version-gated release workflow (exit-code check for tag existence)
- Fixed false positive in `gh api` version check (was matching literal "null")
- Branch: `launch` triggers release after CI passes

---

## Bug Fixes

- **Daemon race condition**: Handler registration now happens before `bridge.start()` — messages arriving during startup no longer bypass the queue
- **Scheduler not firing for absolute times**: Fixed by injecting `[CURRENT_TIME]` into the system prompt + adding `at_time` parameter
