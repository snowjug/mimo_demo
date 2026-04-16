# The Master Integration Guide: VPrint Kiosk System

This document is your definitive 'zero-to-production' blueprint. Use this guide to stand up a brand new deployment of the **VPrint Kiosk System**. 

**ATTENTION AI ASSISTANT:** This guide now reflects the actual working deployment in this repository. The current stack is:

- Web frontend on Vercel
- Kiosk frontend on Vercel
- Backend API on Northflank
- Firebase for auth, Firestore, and Storage
- Optional FastAPI printer service on a Raspberry Pi for real printing

---

## Current Deployed Architecture

### 1) Web frontend

- Location in this repo: [mimo-frontend/MIMO](mimo-frontend/MIMO)
- Vercel project root: [mimo-frontend](mimo-frontend)
- Purpose: student-facing upload, payment, and PIN receipt flow
- Deployed URL: `https://mimo-web-nine.vercel.app/`

### 2) Kiosk frontend

- Location in this repo: [mimo-kiosk/mimo-frontend](mimo-kiosk/mimo-frontend)
- Vercel project root: [mimo-kiosk](mimo-kiosk)
- Purpose: tablet kiosk PIN entry and print triggering UI
- Deployed URL: `https://mimo-test-dep1-atharv-branch-copy-c.vercel.app/`

### 3) Backend API

- Location in this repo: [mimo-backend](mimo-backend)
- Northflank deployment uses the repo-root [Dockerfile](Dockerfile)
- Purpose: authentication, upload handling, Firestore job creation, payment finalization, and print dispatch
- Deployed health URL: `https://site--disturbed-shelter--jdhq2tzrjfvg.code.run/health`

### 4) Printer service

- Runtime role: receives jobs from the backend and forwards them to the Raspberry Pi / Brother printer setup
- Configured through `FASTAPI_PRINT_URL`
- For local validation, the backend can bypass it with `TEST_PRINT_MODE=true`

---

## What Was Actually Implemented

### Backend behavior

- `POST /register` creates users with `username`, `email`, `password`, and `mobileNumber`
- `POST /login` returns a JWT token
- `POST /upload` accepts multipart uploads and stores job data in Firestore
- `POST /payment-success` marks jobs as paid and generates a 4-digit PIN
- `POST /kiosk/print` accepts `{ pin }` from the kiosk and either prints or simulates printing
- `GET /` and `GET /health` are available for health checks

### Supported file types

The backend accepts:

- `.pdf`
- `.doc`
- `.docx`
- `.txt`
- `.jpg`
- `.jpeg`
- `.png`

### Important runtime mode

When the printer backend is not reachable, set:

```env
TEST_PRINT_MODE=true
```

That allows the kiosk flow to complete without hardware printing. For real printing, set it to `false` and provide a reachable `FASTAPI_PRINT_URL`.

---

## Northflank Deployment

Northflank is used for the backend only.

### Build setup

- Build type: Dockerfile
- Dockerfile location: [Dockerfile](Dockerfile)
- Container port: `3000`
- Build context: repository root

### Required Northflank env vars

```env
PORT=3000
JWT_SECRET=<strong-random-secret>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
CASHFREE_APP_ID=<cashfree-app-id>
CASHFREE_SECRET_KEY=<cashfree-secret-key>
FIREBASE_STORAGE_BUCKET=gs://<project-id>.firebasestorage.app
FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64-of-service-account-json>
FASTAPI_PRINT_URL=http://<raspberry-pi-ip>:8000/print
TEST_PRINT_MODE=false
```

### Firebase credentials on Northflank

The backend accepts either of these secret formats:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`

The base64 path is the one used in this setup because it is easier to paste safely into Northflank.

### Backend startup check

After deployment, verify:

```text
/health -> {"status":"ok"}
```

If `/kiosk/print` returns `500`, first check whether `FASTAPI_PRINT_URL` is configured or whether `TEST_PRINT_MODE=true` is set.

---

## FastAPI Printer Setup

This is the hardware-facing printer service used for real printing.

### Required role

- Accept print jobs from the backend
- Forward PDF output to the Raspberry Pi print stack
- Keep the printer local to the same network as the Pi and Brother printer

### Raspberry Pi side

Typical setup on the Pi:

```bash
sudo apt update
sudo apt install cups libcups2-dev pdftk qpdf libreoffice
pip install fastapi uvicorn python-cups python-multipart
```

### How it is used

- Backend env: `FASTAPI_PRINT_URL=http://<raspberry-pi-ip>:8000/print`
- If the printer path is not ready yet, use `TEST_PRINT_MODE=true` during UI testing

### Pi scripts folder

Create a dedicated folder named [pi-scripts](pi-scripts) for Raspberry Pi printer files. Keep printer code separate from the web apps so the hardware side is easy to maintain and easy for your friend to reuse.

Recommended contents:

- [pi-scripts/README.md](pi-scripts/README.md)
- [pi-scripts/printer_server.py](pi-scripts/printer_server.py)
- [pi-scripts/requirements.txt](pi-scripts/requirements.txt)
- [pi-scripts/start.sh](pi-scripts/start.sh)

The backend sends the printer service a multipart form with:

- `file`: the PDF buffer
- `pin`: the 4-digit PIN

The Pi service should receive that form, save the PDF temporarily, and pass it to CUPS or the Brother printer queue.

### Raspberry Pi connection flow

1. The kiosk submits the PIN to the backend.
2. The backend fetches the job from Firestore.
3. The backend downloads the PDF from Firebase Storage.
4. The backend POSTs the PDF to `FASTAPI_PRINT_URL` as multipart form data.
5. The Pi service receives the file and prints it.
6. The backend marks the Firestore job as completed.

### Do you need scripts?

Yes. A small service script is the cleanest option. It gives you a repeatable printer endpoint, a single place to add printer queue logic, and a simple startup command for the Pi.

### Example Pi setup commands

```bash
sudo apt update
sudo apt install cups libcups2-dev pdftk qpdf libreoffice python3-pip python3-venv
mkdir -p ~/mimo-printer
cd ~/mimo-printer
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn python-cups python-multipart
```

---

## Firebase Service Account Key Procedure

Use this procedure whenever you move the project to a new repo or a new Firebase project.

### Step 1: Open Firebase

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Select the correct project or create a new one.
3. Enable Firestore and Storage if they are not already enabled.

### Step 2: Generate the admin key

1. Open **Project settings**.
2. Open **Service accounts**.
3. Click **Generate new private key**.
4. Download the JSON file.

### Step 3: Convert it for Northflank

Run this in PowerShell:

```powershell
$json = Get-Content "$env:USERPROFILE\Downloads\testv3-a215b-firebase-adminsdk-fbsvc-33cee385f1.json" -Raw
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
Set-Clipboard -Value $base64
```

This copies the encoded secret to your clipboard.

### Step 4: Add it to Northflank

1. Open the Northflank backend service.
2. Go to Environment Variables.
3. Add `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`.
4. Paste the copied value.
5. Redeploy the service.

### Step 5: Revoke the old key later

After the new deployment works, revoke the previous Firebase private key from the Firebase Console so only the current key remains active.

---

## Dockerfile Procedure

The backend is deployed with the root [Dockerfile](Dockerfile) so Northflank can build from the repository root.

### What the Dockerfile does

1. Uses a Node.js base image.
2. Copies the backend package manifest.
3. Installs production dependencies.
4. Copies the backend API source.
5. Exposes port `3000`.
6. Starts the Express server.

### Why this is important

- The backend lives in a subfolder, so automatic buildpack detection is unreliable.
- Docker makes the deployment repeatable.
- Your friend can reuse the same build pattern in a new repo without guessing the deployment root.

---

## Benefits and Speed

This architecture is intentionally simple to operate and quick to test.

### Benefits

- The web frontend and kiosk frontend are deployed separately, so each can be changed without touching the other.
- The backend is containerized, which is safer for printer and Firebase logic than forcing everything into a browser-only deployment.
- Firebase keeps the print jobs and uploaded files centralized.
- `TEST_PRINT_MODE` lets you validate the full flow even when the printer is offline.
- The guide now explains the full deployment path clearly enough for both another developer and an AI agent to follow.

### Speed

- Vercel serves the frontends quickly from the edge.
- PIN lookup is fast because it is a single Firestore query.
- The backend route is lightweight once the file has already been uploaded.
- The only slow step is the physical printer, because that depends on the Raspberry Pi and Brother device.
- In `TEST_PRINT_MODE`, the kiosk flow is almost immediate because no printer handoff happens.

---

## Vercel Deployment

Vercel is used for both frontends.

### Web project

- Root folder: [mimo-frontend](mimo-frontend)
- Wrapper package: [mimo-frontend/package.json](mimo-frontend/package.json)
- Vercel config: [mimo-frontend/vercel.json](mimo-frontend/vercel.json)

### Kiosk project

- Root folder: [mimo-kiosk](mimo-kiosk)
- Wrapper package: [mimo-kiosk/package.json](mimo-kiosk/package.json)
- Vercel config: [mimo-kiosk/vercel.json](mimo-kiosk/vercel.json)

### Shared frontend env var

Both Vercel projects must point to the same backend URL:

```env
VITE_BACKEND_API_URL=https://site--disturbed-shelter--jdhq2tzrjfvg.code.run
```

Important: do not create duplicate `VITE_BACKEND_API_URL` entries in the same Vercel project.

### Why the wrappers exist

The wrappers let Vercel build from the repo subfolders without deploying the wrong root. That fixed the earlier `404: NOT_FOUND` issue on both frontends.

---

## Firebase Setup

Firebase is the shared data layer for the whole flow.

### Services used

- Firestore for `printJobs`
- Firebase Storage for uploaded PDFs
- Firebase Admin SDK on the backend

### Required backend-side storage fields

The backend stores job records with the data needed for kiosk lookup and print execution, including:

- `pin`
- `fileName`
- `fileUrl`
- `status`
- `paymentStatus`
- `printerStatus`
- `createdAt`

### Notes on access

- The backend writes through Firebase Admin SDK
- The kiosk flow reads by PIN through the backend route, not directly from the browser
- Storage downloads must be reachable from the printer flow

---

## End-to-End Smoke Test

The deployed system was validated with this flow:

1. Open the web frontend
2. Register or log in
3. Upload a supported file
4. Complete the payment flow
5. Receive the 4-digit PIN
6. Open the kiosk frontend
7. Enter the PIN
8. Confirm that the kiosk moves to the printing state
9. Confirm that the backend returns either a real print response or a test-mode response

If any step fails:

- `404` on `/kiosk/print` usually means the PIN does not exist in Firestore
- `400` usually means the job exists but is not in the correct paid state
- `500` usually means backend configuration is missing, most often Firebase credentials or printer configuration

---

## Practical Deployment Checklist

1. Set up Firebase project, Firestore, and Storage.
2. Encode the Firebase service account JSON and store it in Northflank as `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`.
3. Deploy the backend to Northflank using the root [Dockerfile](Dockerfile).
4. Set `VITE_BACKEND_API_URL` in both Vercel projects to the Northflank backend URL.
5. Deploy the web frontend from [mimo-frontend](mimo-frontend).
6. Deploy the kiosk frontend from [mimo-kiosk](mimo-kiosk).
7. If using a real printer, deploy the FastAPI printer service and set `FASTAPI_PRINT_URL`.
8. If the printer service is not ready, enable `TEST_PRINT_MODE=true` for validation.

---

## Quick Reference

- Web frontend: `https://mimo-web-nine.vercel.app/`
- Kiosk frontend: `https://mimo-test-dep1-atharv-branch-copy-c.vercel.app/`
- Backend health: `https://site--disturbed-shelter--jdhq2tzrjfvg.code.run/health`
- Backend API base for frontends: `https://site--disturbed-shelter--jdhq2tzrjfvg.code.run`
- Shared frontend env var: `VITE_BACKEND_API_URL`
- Firebase secret env var: `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64`
- Test printing switch: `TEST_PRINT_MODE`


