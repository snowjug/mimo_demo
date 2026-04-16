# Pi Scripts Guide

This folder contains the Raspberry Pi side of the print pipeline. The backend sends a PDF and PIN to the Pi printer service, and these scripts keep that service reliable and easy to maintain.

## Files in this folder

### `printer_server.py`

FastAPI service that receives the PDF print job from Northflank.

- Exposes `GET /health`
- Exposes `POST /print`
- Accepts multipart form fields `file` and `pin`
- Saves the PDF temporarily
- Sends it to CUPS using `lp`
- Tries multiple printer queues if `PRINTER_QUEUES` is set
- Returns a clear error if the queue fails

### `requirements.txt`

Python packages needed on the Pi.

### `start.sh`

Simple startup command for local/manual runs.

### `setup_tailscale.sh`

Installs and enables Tailscale on the Pi so the backend can reach the printer service even when the Pi is behind NAT or a changing home network.

### `configure_queues.sh`

Helper for checking and setting multiple CUPS queues on the Pi.

### `health_watch.sh`

Small watchdog script that checks the printer service and restarts it if needed.

### `mimo-printer.service`

Systemd service definition for no-downtime restarts.

## Print flow

1. The kiosk sends the PIN to the backend.
2. The backend looks up the job in Firestore.
3. The backend downloads the PDF from Firebase Storage.
4. The backend POSTs the file to the Pi service using multipart form data.
5. The Pi service passes the file to CUPS.
6. The service returns success so the backend can mark the job complete.

## Environment variables

- `PRINTER_NAME`: primary CUPS queue
- `PRINTER_QUEUES`: comma-separated fallback queues
- `PRINT_TMP_DIR`: temp directory for the PDF
- `PI_BIND_HOST`: host for the FastAPI server
- `PI_BIND_PORT`: port for the FastAPI server
- `TAILSCALE_AUTH_KEY`: optional auth key for unattended Tailscale setup

## No-downtime approach

The recommended production pattern is:

1. Run the printer server under systemd.
2. Set the service to restart automatically on failure.
3. Keep Tailscale enabled so the backend can still reach the Pi if the LAN changes.
4. Configure multiple printer queues so one queue can fail over to the next.

## Error handling approach

The printer service should fail fast and return a useful message if:

- the PIN is not 4 digits
- the file is missing
- the upload is empty
- `lp` is missing
- all configured queues fail

## Tailscale setup

Use Tailscale when the Pi is not guaranteed to have a stable public IP.

The backend should point `FASTAPI_PRINT_URL` to the Pi's Tailscale IP or MagicDNS name, for example:

`http://100.x.x.x:8000/print`

## Recommended next steps for the Pi

1. Install Tailscale.
2. Authenticate the Pi to your Tailnet.
3. Install CUPS and register the printer queues.
4. Run the printer service under systemd.
5. Point Northflank `FASTAPI_PRINT_URL` to the Pi endpoint.
6. Test a print job with `TEST_PRINT_MODE=false`.
