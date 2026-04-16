# MIMO Demo - Smart Print Kiosk Platform

A full-stack print workflow with:
- Student web app for upload and payment
- Kiosk app for PIN-based print collection
- Backend API for auth, job management, payment flow, and print dispatch
- Firebase for database and storage
- Raspberry Pi printer bridge for hardware printing

## Live Links (Quick Redirect)

- Web Frontend: https://mimo-web-nine.vercel.app/
- Kiosk Frontend: https://mimo-test-dep1-atharv-branch-copy-c.vercel.app/
- Backend API Base: https://site--disturbed-shelter--jdhq2tzrjfvg.code.run
- Backend Health: https://site--disturbed-shelter--jdhq2tzrjfvg.code.run/health

## Project Structure

- `mimo-frontend/`
  - Wrapper project for web frontend deployment
  - Actual app: `mimo-frontend/MIMO`
- `mimo-kiosk/`
  - Wrapper project for kiosk deployment
  - Actual app: `mimo-kiosk/mimo-frontend`
- `mimo-backend/`
  - Express backend API (`mimo-backend/api/server.js`)
- `pi-scripts/`
  - Raspberry Pi print server scripts and service files
- `docs/`
  - Deployment and setup notes for new environments

## How The System Works

1. User uploads documents in web app.
2. Backend converts/validates files and creates pending print jobs.
3. User completes payment.
4. Backend marks jobs as paid and generates a 4-digit print PIN.
5. User enters PIN on kiosk.
6. Backend dispatches the PDF to FastAPI printer service (or simulates print in test mode).
7. Job status is finalized as completed.

## Tech Stack

- Frontend: React + TypeScript + Vite
- Backend: Node.js + Express
- Data/Auth/Storage: Firebase (Firestore, Storage)
- Payments: Cashfree integration
- Printing bridge: FastAPI service on Raspberry Pi
- Hosting:
  - Frontends: Vercel
  - Backend: Northflank (Docker)

## Key Backend Endpoints

- `GET /` - backend status text
- `GET /health` - health check
- `POST /register`
- `POST /login`
- `POST /google-login`
- `POST /upload` (auth required)
- `POST /create-order` (auth required)
- `GET /verify-payment/:orderId`
- `POST /payment-success` (auth required)
- `GET /generate-print-code` (auth required)
- `POST /kiosk/print`
- `GET /print-history` (auth required)
- `POST /mark-printed`

Main backend file: `mimo-backend/api/server.js`

## Supported Upload File Types

- PDF (`.pdf`)
- DOC / DOCX (`.doc`, `.docx`)
- TXT (`.txt`)
- Images (`.jpg`, `.jpeg`, `.png`)

## Local Development Setup

## 1) Clone and install

```bash
git clone <your-repo-url>
cd mimo_demo
```

Install dependencies in each app:

```bash
npm install --prefix mimo-backend
npm install --prefix mimo-frontend/MIMO
npm install --prefix mimo-kiosk/mimo-frontend
```

## 2) Configure environment variables

Copy example files and fill real values:

- Backend: `mimo-backend/api/.env.example`
- Web frontend: `mimo-frontend/MIMO/.env.example`
- Kiosk frontend: `mimo-kiosk/mimo-frontend/.env.example`

Minimum local values:

```env
# frontend .env files
VITE_BACKEND_API_URL=http://localhost:3000
```

```env
# backend .env
PORT=3000
JWT_SECRET=<strong-secret>
GOOGLE_CLIENT_ID=<google-client-id>
CASHFREE_APP_ID=<cashfree-app-id>
CASHFREE_SECRET_KEY=<cashfree-secret>
FIREBASE_STORAGE_BUCKET=gs://<project-id>.firebasestorage.app
FASTAPI_PRINT_URL=http://<raspberry-pi-ip>:8000/print
TEST_PRINT_MODE=true
```

Note: Set `TEST_PRINT_MODE=true` when printer hardware is unavailable.

## 3) Run backend

```bash
npm --prefix mimo-backend start
```

Backend default local URL: `http://localhost:3000`

## 4) Run web frontend

```bash
npm --prefix mimo-frontend/MIMO run dev
```

## 5) Run kiosk frontend

```bash
npm --prefix mimo-kiosk/mimo-frontend run dev
```

## Deploy Notes

- Frontends deploy on Vercel with SPA rewrites enabled in each project config.
- Backend deploys from repository root Dockerfile.
- For backend secrets on Northflank, use service account env (`FIREBASE_SERVICE_ACCOUNT_JSON` or base64 variant).

See:
- `docs/SETUP_NEW.md`
- `docs/DEPLOYMENT.md`

## Firebase and Security Notes

- Do not commit service account JSON keys.
- Rotate/revoke old Firebase private keys after migration.
- Configure Firestore rules (`firestore.rules`) and storage CORS (`cors.json`) for your bucket.

## Raspberry Pi Printing

The backend posts PDF jobs to `FASTAPI_PRINT_URL` as multipart form data with:
- `file` (PDF)
- `pin` (4-digit code)

Printer service implementation lives in `pi-scripts/`.

## Troubleshooting

- Backend `500` on kiosk print:
  - Verify `FASTAPI_PRINT_URL` is reachable, or set `TEST_PRINT_MODE=true`.
- Upload/storage failures:
  - Verify Firebase bucket and service account credentials.
- Frontend API issues:
  - Verify `VITE_BACKEND_API_URL` in both frontend apps.

## License

Internal/demo project. Add a formal LICENSE file if this is going public.
