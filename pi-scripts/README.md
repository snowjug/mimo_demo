# Pi Scripts

This folder contains the Raspberry Pi printer service used by the backend print flow.

## What the backend sends

The Northflank backend POSTs a multipart form to `FASTAPI_PRINT_URL` with:

- `file`: the PDF file buffer
- `pin`: the 4-digit PIN

## What this service should do

1. Accept the uploaded PDF.
2. Save it temporarily on the Pi.
3. Send it to CUPS or the Brother printer queue.
4. Return a success response so the backend can mark the job completed.

## Suggested setup

```bash
sudo apt update
sudo apt install cups libcups2-dev pdftk qpdf libreoffice python3-pip python3-venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn printer_server:app --host 0.0.0.0 --port 8000
```

## Environment variables

- `PRINTER_NAME`: optional CUPS queue name
- `PRINT_TMP_DIR`: optional temp directory for saved PDF files
- `PI_BIND_HOST`: optional host to bind the FastAPI server to
- `PI_BIND_PORT`: optional port to bind the FastAPI server to

## Production note

If you only need end-to-end UI validation, set `TEST_PRINT_MODE=true` in the backend and skip the physical printer step until the Pi service is ready.
