# VPrint / Mimo Workspace Summary

## What the guide expects
The `SETUP_NEW.md` file describes a 3-folder architecture:
- `frontend/`: student storefront
- `backend/`: Node.js processor API
- `kiosk-tablet-frontend/`: locked-down kiosk UI, ideally Next.js

## What exists in this workspace
- `mimo-backend/`: Express backend with Firebase Admin bootstrap and payment-related dependencies
- `mimo-frontend/MIMO/`: React + Vite storefront UI
- `mimo-kiosk/mimo-frontend/`: React kiosk UI, currently not Next.js

## Current state
- No `.env` files were found at the workspace root or inside the app folders.
- No `firestore.rules`, `cors.json`, or `vercel.json` files were found.
- `mimo-backend/api/firebase.js` currently requires `serviceAccountKey.json` from the backend folder and hardcodes a Firebase Storage bucket name.
- The storefront and kiosk apps are already implemented, but their routing and runtime model do not yet match the guide exactly.

## Main mismatches vs the guide
- The guide expects a Next.js kiosk app, but the current kiosk is a React/Vite app.
- The guide expects Firebase, Cashfree, and print-job wiring to be standardized across the three folders, but those environment/config files are not present yet.
- The guide assumes a `printJobs` Firestore collection with a `pin` field and kiosk lookup flow, which is not yet visible in the current code.

## Information still needed before making changes
- Exact target folder mapping if the current names should be preserved or renamed.
- Confirmation of which `package.json` files should be treated as authoritative.
- Firebase Web SDK values.
- Cashfree App ID and Secret Key.
- Full `serviceAccountKey.json` contents or an approved secure file placement plan.
- Raspberry Pi print URL for `NEXT_PUBLIC_FASTAPI_PRINT_URL`.

## Recommended next step
Once those values are available, I can turn this into a concrete setup pass: create the env files, align the backend Firebase wiring, and reconcile the kiosk app structure with the guide.
