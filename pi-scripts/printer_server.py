import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Annotated, List

import aiofiles
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

app = FastAPI(title="Mimo Pi Printer Service")

PRINTER_NAME = os.getenv("PRINTER_NAME", "").strip()
PRINTER_QUEUES = [queue.strip() for queue in os.getenv("PRINTER_QUEUES", "").split(",") if queue.strip()]
PRINT_TMP_DIR = os.getenv("PRINT_TMP_DIR", tempfile.gettempdir())


def get_queue_candidates() -> List[str]:
    queues: List[str] = []
    if PRINTER_NAME:
        queues.append(PRINTER_NAME)
    queues.extend([queue for queue in PRINTER_QUEUES if queue not in queues])
    return queues


def run_print_command(temp_path: str) -> str:
    lp_path = shutil.which("lp")
    if not lp_path:
        raise HTTPException(status_code=500, detail="CUPS lp command is not installed")

    queue_candidates = get_queue_candidates()
    if not queue_candidates:
        queue_candidates = [""]

    errors = []
    for queue_name in queue_candidates:
        command = [lp_path, temp_path]
        if queue_name:
            command = [lp_path, "-d", queue_name, temp_path]

        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0:
            return queue_name or "default"

        errors.append((queue_name or "default", result.stderr.strip() or result.stdout.strip() or "Printer command failed"))

    details = "; ".join(f"{queue}: {message}" for queue, message in errors) or "No printer queues available"
    raise HTTPException(status_code=502, detail=details)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post(
    "/print",
    responses={
        400: {"description": "Bad request"},
        500: {"description": "Printer service error"},
        502: {"description": "All printer queues failed"},
    },
)
async def print_pdf(
    file: Annotated[UploadFile, File(...)],
    pin: Annotated[str, Form(...)],
):
    if len(str(pin)) != 4:
        raise HTTPException(status_code=400, detail="A valid 4-digit PIN is required")

    if file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name")

    os.makedirs(PRINT_TMP_DIR, exist_ok=True)
    temp_path = Path(PRINT_TMP_DIR) / (file.filename or f"print-{pin}.pdf")

    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        async with aiofiles.open(temp_path, "wb") as output_file:
            await output_file.write(content)

        selected_queue = run_print_command(str(temp_path))

        return {
            "status": "queued",
            "pin": pin,
            "printerName": selected_queue,
            "fileName": file.filename,
        }
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
