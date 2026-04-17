# 🧪 End-to-End Smoke Test Checklist

**Date**: April 17, 2026  
**Tester**: [Your Name]  
**Environment**: [Local / Northflank / Production]

## Pre-Test Setup
- [ ] Backend running and connected to Firebase
- [ ] Frontend running (http://localhost:5173 or Vercel)
- [ ] Kiosk app running or accessible
- [ ] Cashfree Sandbox API keys configured
- [ ] FASTAPI_PRINT_URL configured (or TEST_PRINT_MODE=true)
- [ ] User authenticated in frontend

---

## Test Flow

### 1️⃣ Upload File (< 500ms expected)
```bash
Frontend: Select PDF file → Click "Upload"
```
- [ ] File accepted
- [ ] No errors in console
- [ ] Response shows `filesUploaded: 1`
- [ ] Response shows `estimatedPages` > 0
- [ ] Response shows `estimatedAmount` > 0
- [ ] Status shows "processing"
- **Expected**: ✅ Page count shows 5-50 (depends on PDF)

---

### 2️⃣ Checkout (< 5s expected)
```bash
Frontend: Click "Proceed to Checkout"
```
Backend trace:
- [ ] `/create-order` called (authenticated header present)
- [ ] `processPendingConversionsForUser()` runs:
  - [ ] Queries for `status="pending_conversion"` jobs
  - [ ] Downloads file from Storage (check logs: "File download")
  - [ ] Converts to PDF (check logs: "PDF conversion")
  - [ ] Saves converted PDF to Storage
  - [ ] Updates job: `status="pending"` + `pageCount` set
- [ ] Queries for `status="pending"` jobs (finds converted job!)
- [ ] Creates Cashfree order
- [ ] Backend responds with `paymentSessionId`

Frontend:
- [ ] Checkout page shows **correct page count** (NOT zero!)
- [ ] Checkout page shows **correct amount** (NOT zero!)
- [ ] Amount = pageCount * ₹2.3
- [ ] Promo code section visible
- [ ] "Pay Now" button clickable
- **Expected**: ✅ Pages and rupees are non-zero

---

### 3️⃣ Payment (via Cashfree Sandbox)
```bash
Frontend: Click "Pay Now"
```
- [ ] Cashfree checkout modal opens
- [ ] Card: `4111 1111 1111 1111` (Visa test)
- [ ] Expiry: `12/25`
- [ ] CVV: `123`
- [ ] OTP: `123456` (Cashfree sandbox auto-approves)
- [ ] Payment success message appears
- **Expected**: ✅ Toast: "Payment successful!"

---

### 4️⃣ Get Print Code (immediately after payment)
Backend `/payment-success`:
- [ ] Queries for `status="pending"` jobs
- [ ] Generates unique 4-digit PIN
- [ ] Batch-updates jobs: `status="paid"` + `pin="1234"`
- [ ] ASYNC: Prefetches PDF into memory cache
- [ ] Responds with `{ pin, printCode }`

Frontend:
- [ ] Navigates to print-code page
- [ ] Shows 4-digit PIN (e.g., "1234")
- [ ] PIN is displayed prominently
- [ ] PIN can be copied
- **Expected**: ✅ PIN visible and readable

---

### 5️⃣ Kiosk Entry
```bash
Kiosk: Open app or navigate to PIN entry screen
```
- [ ] PIN entry screen shows
- [ ] PIN input field clickable
- [ ] Can type 4 digits

---

### 6️⃣ Enter PIN in Kiosk (< 2s expected)
```bash
Kiosk: Type PIN "1234" → Press "Get Documents"
```
Backend `/get-documents-by-code`:
- [ ] Queries for `pin="1234"` && `status="paid"`
- [ ] Returns list of documents with URLs

Kiosk Frontend:
- [ ] Documents appear
- [ ] Shows file name, number of copies
- [ ] Shows "Print" button
- **Expected**: ✅ Document list loads

---

### 7️⃣ Print Document (< 1s expected if cached)
```bash
Kiosk: Click "Print" button
```
Backend `/kiosk/print`:
- [ ] Queries for job with `pin="1234"`
- [ ] **Check cache**: HIT (prefetched in step 4)
  - [ ] PDF retrieved from memory (< 10ms)
- [ ] OR if cache miss:
  - [ ] Downloads from Storage (< 5s timeout)
  - [ ] Saves to cache
- [ ] Sends to printer via FASTAPI_PRINT_URL (< 8s timeout)
- [ ] Updates: `status="completed"`, `isPrinted=true`
- [ ] Returns success

Kiosk Frontend:
- [ ] "Printing..." message appears
- [ ] Printer LED blinks/responds
- [ ] Success message: "Print completed"
- [ ] Document marked as printed
- **Expected**: ✅ File prints to Raspberry Pi

---

## Failure Scenarios (Test these if step 7 fails)

### ❌ Zero pages/amount on checkout
- [ ] Check backend logs for `processPendingConversionsForUser()` errors
- [ ] Verify Firebase connection
- [ ] Verify LibreOffice is installed (`which soffice`)
- [ ] **Fix**: Restart backend, retry upload

### ❌ Payment fails at Cashfree
- [ ] Check backend logs for Cashfree API errors
- [ ] Verify `CASHFREE_API_KEY` and `CASHFREE_API_SECRET`
- [ ] Check Cashfree dashboard for order creation
- [ ] **Fix**: Verify API credentials

### ❌ PIN not generated
- [ ] Check backend logs for `/payment-success` errors
- [ ] Verify jobs were converted to `status="pending"`
- [ ] Check Firestore: printJobs collection for `userId`
- [ ] **Fix**: Restart backend, retry payment

### ❌ Kiosk doesn't find PIN
- [ ] Check backend logs for `/get-documents-by-code` errors
- [ ] Verify job has `status="paid"` in Firestore
- [ ] Verify PIN matches exactly
- [ ] **Fix**: Check job status in Firebase console

### ❌ Print fails / timeout
- [ ] Check if `TEST_PRINT_MODE=true` (simulates print)
- [ ] Verify `FASTAPI_PRINT_URL` is set and reachable
- [ ] Check Raspberry Pi service is running: `systemctl status mimo-printer`
- [ ] Check backend logs for "Printer dispatch" timeout
- [ ] **Fix**: Restart printer service or use TEST_PRINT_MODE

---

## Metrics to Track

| Metric | Target | Actual | Pass? |
|--------|--------|--------|-------|
| Upload latency | < 500ms | | |
| Checkout latency | < 5s | | |
| Page count conversion | > 0 pages | | |
| Amount calculation | > ₹0 | | |
| PIN generation | 4 digits | | |
| Kiosk document fetch | < 2s | | |
| Print dispatch | < 1s (cached) | | |
| Cache hit rate | 80%+ | | |

---

## Backend Logs Checklist

After running the test, check backend logs for:

```log
✅ /upload: "Files queued for processing"
✅ /create-order: "processPendingConversionsForUser" called
✅ /create-order: "File download" timeout hit (30s)
✅ /create-order: "PDF conversion" timeout hit (60s)
✅ /create-order: pageCount extracted
✅ /create-order: Cashfree order created
✅ /payment-success: PIN generated
✅ /payment-success: Batch update committed
✅ /get-documents-by-code: Documents returned
✅ /kiosk/print: Cache hit OR file downloaded
✅ /kiosk/print: Printer dispatch sent (8s timeout)
✅ /kiosk/print: Job marked as completed
```

---

## Sign-Off

**Tester Name**: ___________________  
**Date**: ___________________  
**Result**: ✅ PASS / ❌ FAIL  
**Issues Found**: ___________________  
**Notes**: ___________________

---

## Rollback Plan (if test fails)

If any step fails:
1. Stop backend: `Ctrl+C`
2. Revert to last commit: `git log --oneline` (check commit de0b1a4)
3. Investigate error in logs
4. Fix issue or roll back: `git reset --hard HEAD~1`
5. Restart backend
6. Re-run test

