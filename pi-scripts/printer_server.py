import os
import tempfile
import subprocess
from fastapi import FastAPI, UploadFile, File, Form, HTTPException

app = FastAPI(title="Mimo Pi Printer Service")

PRINTER_NAME = os.getenv("PRINTER_NAME", "")
PRINT_TMP_DIR = os.getenv("PRINT_TMP_DIR", tempfile.gettempdir())


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/print")
async def print_pdf(file: UploadFile = File(...), pin: str = Form(...)):
    if len(str(pin)) != 4:
        raise HTTPException(status_code=400, detail="A valid 4-digit PIN is required")

    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported")

    os.makedirs(PRINT_TMP_DIR, exist_ok=True)
    temp_path = os.path.join(PRINT_TMP_DIR, file.filename or f"print-{pin}.pdf")

    content = await file.read()
    with open(temp_path, "wb") as output_file:
        output_file.write(content)

    try:
        command = ["lp", temp_path]
        if PRINTER_NAME:
            command = ["lp", "-d", PRINTER_NAME, temp_path]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=result.stderr.strip() or "Printer command failed")
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass

    return {
        "status": "queued",
        "pin": pin,
        "printerName": PRINTER_NAME or "default",
        "fileName": file.filename,
    }
