const dotenv = require("dotenv");
const path = require("node:path");

// Load env from api/.env regardless of process working directory.
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const fs = require("node:fs");
const os = require("node:os");
const { promisify } = require("node:util");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("node:crypto");
const libre = require("libreoffice-convert");
const { db, bucket } = require("./firebase");
const {
  PRICE_PER_PAGE,
  normalizeApiError,
  buildUploadApiResponse,
  summarizeOps,
  detectOpsAlerts,
} = require("./flow-utils");

const libreConvert = promisify(libre.convert);

const FASTAPI_PRINT_URL = process.env.FASTAPI_PRINT_URL || process.env.NEXT_PUBLIC_FASTAPI_PRINT_URL;
const TEST_PRINT_MODE = String(process.env.TEST_PRINT_MODE || "").toLowerCase() === "true";
const OPS_ALERT_WEBHOOK_URL = process.env.OPS_ALERT_WEBHOOK_URL || "";
const OPS_DASHBOARD_KEY = process.env.OPS_DASHBOARD_KEY || "";
const PDF_CACHE_MAX_MB = Number(process.env.PDF_CACHE_MAX_MB || 96);

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
]);

const COLLECTIONS = {
  USERS: "users",
  PRINT_JOBS: "printJobs",
  ORDERS: "orders",
  PAYMENT_TRANSACTIONS: "payment_transactions",
  KIOSK_MACHINES: "kiosk_machines",
};

const nowMs = () => Date.now();

const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const formatLocalDateTime = (value) => {
  const millis = toMillis(value);
  return millis === null ? "N/A" : new Date(millis).toLocaleString();
};

const emitOpsAlert = async ({ code, severity = "medium", message, context = {} }) => {
  const payload = {
    code,
    severity,
    message,
    context,
    createdAt: nowMs(),
  };

  try {
    await db.collection("ops_alerts").add(payload);
  } catch (err) {
    console.warn("Failed to persist ops alert:", err.message);
  }

  if (OPS_ALERT_WEBHOOK_URL) {
    try {
      await axios.post(OPS_ALERT_WEBHOOK_URL, payload, { timeout: 5000 });
    } catch (err) {
      console.warn("Failed to send ops webhook alert:", err.message);
    }
  }
};

const sendApiError = (res, status, error, fallbackCode, fallbackMessage) => {
  const normalized = normalizeApiError(error, fallbackCode, fallbackMessage);
  return res.status(status).json({
    ok: false,
    error: normalized,
  });
};

const sendApiSuccess = (res, payload, status = 200) => {
  return res.status(status).json({
    ok: true,
    ...payload,
  });
};

const defaultPrintOptions = {
  copies: 1,
  printMode: "a4_sheet",
  pagesPerSheet: 1,
  colorMode: "bw",
  layout: "single",
  pageSelection: "all",
  startPage: null,
  endPage: null,
  duplexMode: "simplex",
};

const buildPrintJobUploadDoc = ({ userId, jobId, file, fileUrl, sessionId, ipAddress, userAgent }) => {
  const createdAtMs = nowMs();

  return {
    // Legacy fields kept for current app compatibility.
    userId,
    sourceFileName: file.originalname,
    fileUrl,
    status: "pending_conversion",
    createdAt: new Date(createdAtMs),

    // New schema fields.
    jobId,
    orderId: null,
    kioskId: null,
    pin: null,
    sourceFile: {
      fileName: file.originalname,
      originalExtension: path.extname(file.originalname || "").toLowerCase(),
      mimeType: file.mimetype || "application/octet-stream",
      fileSizeBytes: Number(file.size || 0),
      uploadedAt: createdAtMs,
      uploadDurationMs: null,
    },
    conversionDetails: {
      convertedAt: null,
      originalPageCount: null,
      actualPageCount: null,
      isConverting: false,
      conversionDurationMs: null,
      conversionSuccess: null,
      conversionError: null,
      storagePath: fileUrl,
      storageSizeBytes: Number(file.size || 0),
    },
    printOptions: { ...defaultPrintOptions },
    pricing: {
      pricePerPage: PRICE_PER_PAGE,
      totalPages: null,
      copiesRequested: 1,
      totalPagesToPrint: null,
      estimatedAmount: null,
      finalAmount: null,
      currency: "INR",
      taxPercent: 0,
      taxAmount: 0,
      discountCode: null,
      discountAmount: 0,
    },
    paymentStatus: {
      status: "pending",
      paymentMethod: "cashfree",
      transactionId: null,
      paidAt: null,
      paymentGatewayResponse: null,
    },
    printStatus: {
      status: "uploaded",
      retrievedAt: null,
      printStartedAt: null,
      printCompletedAt: null,
      durationSeconds: null,
      printErrorCode: null,
      printErrorMessage: null,
      printerJobId: null,
    },
    timeline: {
      createdAt: createdAtMs,
      uploadedAt: createdAtMs,
      conversionStartedAt: null,
      conversionCompletedAt: null,
      orderCreatedAt: null,
      paymentInitiatedAt: null,
      paymentCompletedAt: null,
      retrievedAt: null,
      printStartedAt: null,
      printCompletedAt: null,
      expiresAt: null,
    },
    metadata: {
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      sessionId: sessionId || null,
      tags: [],
    },
  };
};

const isSupportedUpload = (file) => {
  const ext = path.extname(file?.originalname || "").toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
};

const generateUniquePin = async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    const snapshot = await db.collection("printJobs").where("pin", "==", pin).limit(1).get();
    if (snapshot.empty) {
      return pin;
    }
  }

  throw new Error("Unable to generate a unique 4-digit PIN");
};

const downloadJobPdf = async (jobData) => {
  const filePath = jobData.fileUrl.split(`${bucket.name}/`)[1];
  const file = bucket.file(filePath);
  const [fileBuffer] = await file.download();
  return fileBuffer;
};

const pdfCache = new Map();
const PDF_CACHE_TTL = 15 * 60 * 1000;
const MAX_CACHE_SIZE = Math.max(16, PDF_CACHE_MAX_MB) * 1024 * 1024;
let cacheSizeBytes = 0;

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pdfCache.entries()) {
    if (value.expiry < now) {
      cacheSizeBytes -= value.buffer.length;
      pdfCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

const cacheJobPdf = (pin, buffer) => {
  // Evict oldest if over limit
  if (cacheSizeBytes + buffer.length > MAX_CACHE_SIZE) {
    const oldestPin = Array.from(pdfCache.keys())[0];
    const oldestItem = pdfCache.get(oldestPin);
    cacheSizeBytes -= oldestItem.buffer.length;
    pdfCache.delete(oldestPin);
  }
  
  cacheSizeBytes += buffer.length;
  pdfCache.set(pin, {
    buffer,
    expiry: Date.now() + PDF_CACHE_TTL,
  });
};

const getCachedJobPdf = (pin) => {
  const cached = pdfCache.get(pin);
  if (!cached) return null;
  if (cached.expiry < Date.now()) {
    cacheSizeBytes -= cached.buffer.length;
    pdfCache.delete(pin);
    return null;
  }
  return cached.buffer;
};

const withTimeout = (promise, ms, label = "Operation") => {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timeout after ${ms}ms`));
      }, ms);
      promise.finally(() => clearTimeout(timer));
    }),
  ]);
};

const convertFileToPdf = async (file) => {
  const originalName = file.originalname || "upload";
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".pdf") {
    return {
      pdfBuffer: file.buffer,
      outputFileName: originalName,
    };
  }

  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
    const pdfDoc = await PDFDocument.create();
    const embedded = ext === ".png"
      ? await pdfDoc.embedPng(file.buffer)
      : await pdfDoc.embedJpg(file.buffer);

    const page = pdfDoc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });

    const pdfBytes = await pdfDoc.save();
    const outputFileName = `${path.basename(originalName, ext)}.pdf`;
    return {
      pdfBuffer: Buffer.from(pdfBytes),
      outputFileName,
    };
  }

  if (ext === ".txt") {
    const text = file.buffer.toString("utf8");
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const maxCharsPerLine = 90;
    const lines = text
      .split(/\r?\n/)
      .flatMap((line) => {
        if (!line) return [""];
        const chunks = [];
        for (let i = 0; i < line.length; i += maxCharsPerLine) {
          chunks.push(line.slice(i, i + maxCharsPerLine));
        }
        return chunks;
      })
      .slice(0, 120);

    page.drawText(lines.join("\n"), {
      x: 40,
      y: 800,
      size: 10,
      lineHeight: 12,
      maxWidth: 515,
    });

    const pdfBytes = await pdfDoc.save();
    const outputFileName = `${path.basename(originalName, ext)}.pdf`;
    return {
      pdfBuffer: Buffer.from(pdfBytes),
      outputFileName,
    };
  }

  let tempInputPath;
  try {
    tempInputPath = path.join(os.tmpdir(), `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tempInputPath, file.buffer);

    const convertedPdf = await libreConvert(
      fs.readFileSync(tempInputPath),
      ".pdf",
      undefined
    );

    const outputFileName = `${path.basename(originalName, ext)}.pdf`;
    return {
      pdfBuffer: convertedPdf,
      outputFileName,
    };
  } finally {
    if (tempInputPath && fs.existsSync(tempInputPath)) {
      fs.unlinkSync(tempInputPath);
    }
  }
};

// ================= APP =================
const app = express();

const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  ...configuredOrigins,
]);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  // Allow Vercel preview/production domains without listing each deployment URL.
  return /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin);
};

app.use(express.json({ limit: "100mb" }));
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
const upload = multer({ storage: multer.memoryStorage() });
const SECRET_KEY = process.env.JWT_SECRET;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.get("/", (_req, res) => {
  res.status(200).send("mimo backend running");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  try {
    await withTimeout(
      db.collection(COLLECTIONS.USERS).limit(1).get(),
      3000,
      "Firestore readiness check"
    );
    return res.status(200).json({ status: "ready" });
  } catch (err) {
    return res.status(503).json({
      status: "not_ready",
      message: err.message,
    });
  }
});

app.get("/ops/checks", async (req, res) => {
  try {
    if (OPS_DASHBOARD_KEY && req.headers["x-ops-key"] !== OPS_DASHBOARD_KEY) {
      return sendApiError(res, 403, null, "forbidden", "Invalid ops key");
    }

    const [pendingConversionSnap, pendingPaymentSnap, paidReadySnap, kioskSnap] = await Promise.all([
      db.collection(COLLECTIONS.PRINT_JOBS).where("status", "==", "pending_conversion").get(),
      db.collection(COLLECTIONS.PRINT_JOBS).where("status", "==", "pending").get(),
      db.collection(COLLECTIONS.PRINT_JOBS).where("status", "==", "paid").get(),
      db.collection(COLLECTIONS.KIOSK_MACHINES).get(),
    ]);

    const opsSummary = summarizeOps({
      pendingConversionCount: pendingConversionSnap.size,
      pendingPaymentCount: pendingPaymentSnap.size,
      paidReadyCount: paidReadySnap.size,
      kiosks: kioskSnap.docs.map((doc) => doc.data()),
    });

    const alerts = detectOpsAlerts(opsSummary, {
      backlogThreshold: Number(process.env.OPS_BACKLOG_THRESHOLD || 25),
    });

    for (const alert of alerts) {
      await emitOpsAlert(alert);
    }

    return sendApiSuccess(res, {
      checks: opsSummary,
      alertsTriggered: alerts.length,
      alerts,
    });
  } catch (err) {
    console.error(err);
    return sendApiError(res, 500, err, "ops_checks_failed", "Failed to run ops checks");
  }
});

// ================= CASHFREE =================
const CASHFREE_BASE_URL = "https://sandbox.cashfree.com/pg";

const cashfreeClientId =
  process.env.CASHFREE_APP_ID ||
  process.env.CASHFREE_API_KEY ||
  process.env.CASHFREE_CLIENT_ID;

const cashfreeClientSecret =
  process.env.CASHFREE_SECRET_KEY ||
  process.env.CASHFREE_API_SECRET ||
  process.env.CASHFREE_CLIENT_SECRET;

const cashfreeHeaders = {
  "Content-Type": "application/json",
  "x-client-id": cashfreeClientId,
  "x-client-secret": cashfreeClientSecret,
  "x-api-version": "2025-01-01",
};

// ================= AUTH MIDDLEWARE =================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    console.error("❌ No token. Authorization header:", authHeader);
    return res.status(401).send("Token missing");
  }

  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) {
      console.error("❌ JWT verify error:", err.message);
      return res.status(403).send("Invalid token");
    }

    // DEBUG — shows what is inside your token so we can diagnose issues
    console.log("🔍 Decoded token payload:", JSON.stringify(decoded));

    // Supports { userId }, { id }, or { user: { id } } shaped tokens
    const userId = decoded.userId || decoded.id || decoded.user?.id;

    if (!userId) {
      console.error("❌ No userId found in token. Payload:", JSON.stringify(decoded));
      return res.status(403).send("Invalid token payload");
    }

    req.user = { ...decoded, userId };
    next();
  });
};

// ================= PAGE COUNT =================
const getPageCount = async (pdfBuffer) => {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    return pdfDoc.getPageCount();

  } catch (err) {
    console.error("Page count error:", err);
    return 1;
  }
};

// ================= STORAGE =================
const uploadToStorage = async (file) => {
  const fileName = `files/${Date.now()}_${file.originalname}`;
  const fileUpload = bucket.file(fileName);
  await fileUpload.save(file.buffer);
  return `https://storage.googleapis.com/${bucket.name}/${fileName}`;
};

// ================= REGISTER =================
app.post("/register", async (req, res) => {
  try {
    const { username, password, email, mobileNumber } = req.body;
    const existing = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();
    if (!existing.empty) {
      return res.status(400).send("User already exists");
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const timestamp = nowMs();
    await db.collection(COLLECTIONS.USERS).add({
      id: userId,
      userId,
      username,
      name: username,
      password: hashedPassword,
      passwordHash: hashedPassword,
      email,
      mobileNumber,
      phoneNumber: mobileNumber || "",
      googleUser: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      accountStatus: "active",
      totalSpent: 0,
      totalPagesPrinted: 0,
      preferredPaymentMethod: "cashfree",
      lastLoginAt: null,
      defaultPrintSettings: {
        colorMode: "bw",
        layout: "single",
        paperSize: "a4",
      },
      isVerified: false,
      verificationMethod: "email",
    });
    res.send("Registered successfully");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error registering user");
  }
});

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const snapshot = await db.collection("users").where("email", "==", email).get();
    if (snapshot.empty) return res.status(400).send("User not found");
    const doc = snapshot.docs[0];
    const user = doc.data();
    if (user.googleUser) return res.status(400).send("Use Google login");
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).send("Wrong password");
    // Fall back to Firestore doc ID if custom id field is missing
    const userId = user.id || doc.id;
    if (!userId) return res.status(500).send("User ID missing in database");
    const token = jwt.sign({ userId }, SECRET_KEY);
    res.json({ jwtToken: token });
  } catch (err) {
    console.error(err);
    res.status(500).send("Login failed");
  }
});

// ================= GOOGLE LOGIN =================
app.post("/google-login", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).send("Token missing");
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const snapshot = await db.collection(COLLECTIONS.USERS).where("email", "==", email).get();
    let userId;
    if (snapshot.empty) {
      userId = uuidv4();
      const timestamp = nowMs();
      await db.collection(COLLECTIONS.USERS).add({
        id: userId,
        userId,
        username: name,
        name,
        email,
        password: null,
        passwordHash: null,
        mobileNumber: "",
        phoneNumber: "",
        googleUser: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        accountStatus: "active",
        totalSpent: 0,
        totalPagesPrinted: 0,
        preferredPaymentMethod: "cashfree",
        lastLoginAt: timestamp,
        defaultPrintSettings: {
          colorMode: "bw",
          layout: "single",
          paperSize: "a4",
        },
        isVerified: true,
        verificationMethod: "google",
      });
    } else {
      const doc = snapshot.docs[0];
      // Fall back to Firestore doc ID if custom id field is missing
      userId = doc.data().id || doc.id;
      await doc.ref.update({ updatedAt: nowMs(), lastLoginAt: nowMs() });
    }
    if (!userId) return res.status(500).send("User ID missing in database");
    const jwtToken = jwt.sign({ userId }, SECRET_KEY);
    res.json({ jwtToken, name, email });
  } catch (err) {
    console.error(err);
    res.status(401).send("Google login failed");
  }
});

// ================= ONBOARDING =================
app.post("/onboarding", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username } = req.body;
    if (!username) return res.status(400).send("Name required");
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    await snapshot.docs[0].ref.update({ username, onboardingCompleted: true });
    res.send("Onboarding complete");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed onboarding");
  }
});

// ================= USER =================
app.get("/mimo/user", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    const user = snapshot.docs[0].data();
    res.json({ name: user.username, email: user.email });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching user");
  }
});

// ================= PROFILE =================
app.get("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    const user = snapshot.docs[0].data();
    res.json({
      username: user.username,
      email: user.email,
      mobileNumber: user.mobileNumber,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch profile");
  }
});

app.put("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, mobileNumber } = req.body;
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    await snapshot.docs[0].ref.update({ username, mobileNumber });
    res.send("Profile updated");
  } catch (err) {
    console.error(err);
    res.status(500).send("Update failed");
  }
});

// ================= SETTINGS =================
app.post("/settings", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = req.body;
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    await snapshot.docs[0].ref.update({ settings });
    res.send("Settings saved");
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to save settings");
  }
});

app.get("/settings", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    const user = snapshot.docs[0].data();
    res.json(user.settings || undefined);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch settings");
  }
});

// ================= COINS =================
app.get("/mimo/coins", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const snapshot = await db.collection("users").where("id", "==", userId).get();
    if (snapshot.empty) return res.status(404).send("User not found");
    const user = snapshot.docs[0].data();
    const coins = user.mimoCoins || { balance: 0, totalEarned: 0, totalUsed: 0 };
    res.json({
      balance: coins.balance,
      totalEarned: coins.totalEarned,
      totalUsed: coins.totalUsed,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching coins" });
  }
});

app.post("/payment-success", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const selectedPrintOptions = req.body?.printOptions && typeof req.body.printOptions === "object"
      ? req.body.printOptions
      : {};
    const paidAtMs = nowMs();
    const paidAtDate = new Date(paidAtMs);

    const snapshot = await db
      .collection(COLLECTIONS.PRINT_JOBS)
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();

    if (snapshot.empty) {
      const alreadyPaid = await db
        .collection(COLLECTIONS.PRINT_JOBS)
        .where("userId", "==", userId)
        .where("status", "==", "paid")
        .limit(1)
        .get();

      if (!alreadyPaid.empty) {
        const existing = alreadyPaid.docs[0].data();
        return sendApiSuccess(res, {
          message: "Payment already marked successful",
          pin: existing.pin || existing.printCode || null,
          printCode: existing.pin || existing.printCode || null,
        });
      }

      return sendApiError(res, 400, null, "no_pending_jobs", "No pending jobs found");
    }

    const pin = await generateUniquePin();
    const expiresAtMs = paidAtMs + 12 * 60 * 60 * 1000;
    const expiresAt = new Date(expiresAtMs);

    const batch = db.batch();

    snapshot.forEach((doc) => {
      const existing = doc.data();
      batch.update(doc.ref, {
        status: "paid",
        pin,
        printCode: pin,
        printOptions: {
          ...(existing.printOptions || defaultPrintOptions),
          ...selectedPrintOptions,
        },
        codeCreatedAt: paidAtDate,
        codeExpiresAt: expiresAt,
        isPrinted: false,
        printerStatus: "ready",
        paymentStatus: {
          ...(existing.paymentStatus || undefined),
          status: "completed",
          paymentMethod: "cashfree",
          transactionId: null,
          paidAt: paidAtMs,
          paymentGatewayResponse: existing.paymentStatus?.paymentGatewayResponse || null,
        },
        printStatus: {
          ...(existing.printStatus || undefined),
          status: "ready",
        },
        timeline: {
          ...(existing.timeline || undefined),
          paymentCompletedAt: paidAtMs,
          expiresAt: expiresAtMs,
        },
      });
    });

    await batch.commit();

    sendApiSuccess(res, {
      message: "Payment success",
      pin,
      printCode: pin,
    });

    setImmediate(async () => {
      try {
        const paidJobs = await db
          .collection(COLLECTIONS.PRINT_JOBS)
          .where("userId", "==", userId)
          .where("pin", "==", pin)
          .get();

        for (const jobDoc of paidJobs.docs) {
          const jobData = jobDoc.data();
          try {
            const pdfBuffer = await withTimeout(downloadJobPdf(jobData), 10000, "PDF prefetch");
            cacheJobPdf(pin, pdfBuffer);
          } catch (prefetchErr) {
            console.warn(`Failed to prefetch PDF for PIN ${pin}:`, prefetchErr.message);
          }
        }
      } catch (prefetchErr) {
        console.warn("Failed to prefetch PDFs:", prefetchErr.message);
      }
    });

  } catch (err) {
    console.error(err);
    await emitOpsAlert({
      code: "payment_update_failed",
      severity: "high",
      message: "Payment success update failed",
      context: { details: err.message || String(err) },
    });
    sendApiError(res, 500, err, "payment_update_failed", "Payment update failed");
  }
});

// ================= UPLOAD =================
app.post("/upload", authenticateToken, upload.array("files"), async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) return sendApiError(res, 401, null, "unauthorized", "User ID missing from token");

    if (!req.files || req.files.length === 0) {
      return sendApiError(res, 400, null, "files_required", "At least one file is required");
    }

    const invalidFile = req.files.find((file) => !isSupportedUpload(file));
    if (invalidFile) {
      return sendApiError(res, 400, null, "unsupported_file_type", "Supported files: PDF, DOC, DOCX, TXT, JPG, JPEG, PNG");
    }

    if (req.files.length > Number(process.env.MAX_UPLOAD_FILES || 10)) {
      return sendApiError(res, 400, null, "too_many_files", "Too many files in a single upload request");
    }

    // Clear old pending jobs
    const oldJobs = await db
      .collection(COLLECTIONS.PRINT_JOBS)
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();
    for (let doc of oldJobs.docs) {
      await doc.ref.delete();
    }

    const oldConversionJobs = await db
      .collection(COLLECTIONS.PRINT_JOBS)
      .where("userId", "==", userId)
      .where("status", "==", "pending_conversion")
      .get();
    for (let doc of oldConversionJobs.docs) {
      await doc.ref.delete();
    }

    const uploadPromises = req.files.map(async (file) => {
      const fileName = `files/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.originalname}`;
      const fileUpload = bucket.file(fileName);
      await fileUpload.save(file.buffer);

      const fileUrl = `gs://${bucket.name}/${fileName}`;
      const jobRef = db.collection(COLLECTIONS.PRINT_JOBS).doc();
      await jobRef.set(
        buildPrintJobUploadDoc({
          userId,
          jobId: jobRef.id,
          file,
          fileUrl,
          sessionId: req.headers["x-session-id"],
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        })
      );

      return {
        jobId: jobRef.id,
        fileName: file.originalname,
      };
    });

    const queuedJobs = await Promise.all(uploadPromises);

    // Convert newly uploaded files now so frontend gets accurate page totals.
    await processPendingConversionsForUser(userId);

    const results = [];

    for (const queuedJob of queuedJobs) {
      const docSnap = await db.collection(COLLECTIONS.PRINT_JOBS).doc(queuedJob.jobId).get();
      if (!docSnap.exists) {
        results.push({
          fileName: queuedJob.fileName,
          status: "failed",
          error: "Upload record not found",
        });
        continue;
      }

      const data = docSnap.data();
      const pageCount = Number(data?.pageCount || data?.pricing?.totalPages || 0);
      const amount = Number(data?.pricing?.finalAmount || pageCount * PRICE_PER_PAGE || 0);

      if (data.status === "pending") {
        results.push({
          jobId: docSnap.id,
          fileName: queuedJob.fileName,
          status: "completed",
          pageCount,
          amount: Number(amount.toFixed(2)),
          fileUrl: data.fileUrl || null,
        });
      } else {
        results.push({
          jobId: docSnap.id,
          fileName: queuedJob.fileName,
          status: "failed",
          error: data.conversionError || "Conversion failed",
        });
      }
    }

    return sendApiSuccess(res, buildUploadApiResponse(results, req.files.length));
  } catch (err) {
    console.error(err);
    sendApiError(res, 500, err, "upload_failed", "Upload failed");
  }
});

app.post("/internal/process-conversions", async (_req, res) => {
  try {
    const snapshot = await db
      .collection(COLLECTIONS.PRINT_JOBS)
      .where("status", "==", "pending_conversion")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.json({ processed: 0, message: "No pending conversions" });
    }

    const jobDoc = snapshot.docs[0];
    const jobData = jobDoc.data();

    try {
      const sourceFilePath = jobData.fileUrl.split(`${bucket.name}/`)[1];
      const sourceFile = bucket.file(sourceFilePath);
      const [fileBuffer] = await withTimeout(sourceFile.download(), 30000, "File download");

      const { pdfBuffer, outputFileName } = await withTimeout(
        convertFileToPdf({ originalname: jobData.sourceFileName, buffer: fileBuffer }),
        60000,
        "PDF conversion"
      );

      const pageCount = await getPageCount(pdfBuffer);
      const convertedFileName = `converted/${Date.now()}_${jobDoc.id}.pdf`;
      const convertedFile = bucket.file(convertedFileName);
      await convertedFile.save(pdfBuffer);

      const convertedAtMs = nowMs();
      const conversionStartedMs = jobData?.timeline?.conversionStartedAt || convertedAtMs;
      const estimatedAmount = Number((pageCount * PRICE_PER_PAGE).toFixed(2));

      await jobDoc.ref.update({
        fileName: outputFileName,
        pageCount,
        fileUrl: `gs://${bucket.name}/${convertedFileName}`,
        status: "pending",
        conversionCompletedAt: new Date(convertedAtMs),
        conversionDetails: {
          ...(jobData.conversionDetails || undefined),
          convertedAt: convertedAtMs,
          originalPageCount: pageCount,
          actualPageCount: pageCount,
          isConverting: false,
          conversionDurationMs: Math.max(0, convertedAtMs - conversionStartedMs),
          conversionSuccess: true,
          conversionError: null,
          storagePath: `gs://${bucket.name}/${convertedFileName}`,
          storageSizeBytes: Number(pdfBuffer.length || 0),
        },
        pricing: {
          ...(jobData.pricing || undefined),
          totalPages: pageCount,
          totalPagesToPrint: pageCount,
          estimatedAmount,
          finalAmount: estimatedAmount,
        },
        printStatus: {
          ...(jobData.printStatus || undefined),
          status: "pending_payment",
        },
        timeline: {
          ...(jobData.timeline || undefined),
          conversionCompletedAt: convertedAtMs,
        },
      });

      return res.json({ processed: 1, jobId: jobDoc.id, pageCount });
    } catch (conversionErr) {
      await jobDoc.ref.update({
        status: "conversion_failed",
        conversionError: conversionErr.message,
        failedAt: new Date(),
        conversionDetails: {
          ...(jobData.conversionDetails || undefined),
          isConverting: false,
          conversionSuccess: false,
          conversionError: conversionErr.message,
        },
        printStatus: {
          ...(jobData.printStatus || undefined),
          status: "error",
          printErrorMessage: conversionErr.message,
        },
      });
      return res.status(500).json({ processed: 0, error: "Conversion failed" });
    }
  } catch (err) {
    console.error(err);
    return sendApiError(res, 500, err, "process_conversions_failed", "Failed to process conversions");
  }
});

// ================= HELPER: PROCESS ALL PENDING CONVERSIONS FOR USER =================
const processPendingConversionsForUser = async (userId) => {
  const jobs = await db
    .collection(COLLECTIONS.PRINT_JOBS)
    .where("userId", "==", userId)
    .where("status", "==", "pending_conversion")
    .get();

  for (let doc of jobs.docs) {
    const jobData = await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(doc.ref);
      if (!latest.exists) {
        return null;
      }

      const latestData = latest.data();
      if (latestData.status !== "pending_conversion" || latestData.isConverting) {
        return null;
      }

      transaction.update(doc.ref, {
        isConverting: true,
        conversionStartedAt: new Date(),
        conversionDetails: {
          ...(latestData.conversionDetails || undefined),
          isConverting: true,
        },
        timeline: {
          ...(latestData.timeline || undefined),
          conversionStartedAt: nowMs(),
        },
      });

      return latestData;
    });

    if (!jobData) {
      continue;
    }

    try {
      const sourceFilePath = jobData.fileUrl.split(`${bucket.name}/`)[1];
      const sourceFile = bucket.file(sourceFilePath);
      const [fileBuffer] = await withTimeout(sourceFile.download(), 30000, "File download");

      const { pdfBuffer, outputFileName } = await withTimeout(
        convertFileToPdf({ originalname: jobData.sourceFileName, buffer: fileBuffer }),
        60000,
        "PDF conversion"
      );

      const pageCount = await getPageCount(pdfBuffer);
      const convertedFileName = `converted/${Date.now()}_${doc.id}.pdf`;
      const convertedFile = bucket.file(convertedFileName);
      await convertedFile.save(pdfBuffer);

      const convertedAtMs = nowMs();
      const conversionStartedMs = jobData?.timeline?.conversionStartedAt || convertedAtMs;
      const estimatedAmount = Number((pageCount * PRICE_PER_PAGE).toFixed(2));

      await doc.ref.update({
        fileName: outputFileName,
        pageCount,
        fileUrl: `gs://${bucket.name}/${convertedFileName}`,
        status: "pending",
        isConverting: false,
        conversionCompletedAt: new Date(convertedAtMs),
        conversionDetails: {
          ...(jobData.conversionDetails || undefined),
          convertedAt: convertedAtMs,
          originalPageCount: pageCount,
          actualPageCount: pageCount,
          isConverting: false,
          conversionDurationMs: Math.max(0, convertedAtMs - conversionStartedMs),
          conversionSuccess: true,
          conversionError: null,
          storagePath: `gs://${bucket.name}/${convertedFileName}`,
          storageSizeBytes: Number(pdfBuffer.length || 0),
        },
        pricing: {
          ...(jobData.pricing || undefined),
          totalPages: pageCount,
          totalPagesToPrint: pageCount,
          estimatedAmount,
          finalAmount: estimatedAmount,
        },
        printStatus: {
          ...(jobData.printStatus || undefined),
          status: "pending_payment",
        },
        timeline: {
          ...(jobData.timeline || undefined),
          conversionCompletedAt: convertedAtMs,
        },
      });
    } catch (conversionErr) {
      await emitOpsAlert({
        code: "conversion_failed",
        severity: "high",
        message: "Conversion failed for print job",
        context: {
          jobId: doc.id,
          userId,
          reason: conversionErr.message || "Unknown conversion error",
        },
      });

      await doc.ref.update({
        status: "conversion_failed",
        isConverting: false,
        conversionError: conversionErr.message,
        failedAt: new Date(),
        conversionDetails: {
          ...(jobData.conversionDetails || undefined),
          isConverting: false,
          conversionSuccess: false,
          conversionError: conversionErr.message,
        },
        printStatus: {
          ...(jobData.printStatus || undefined),
          status: "error",
          printErrorMessage: conversionErr.message,
        },
      });
    }
  }
};

// ================= CREATE ORDER =================
app.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // 🔹 AUTO-PROCESS any pending conversions for this user before creating order
    await processPendingConversionsForUser(userId);

    const jobsSnapshot = await db
      .collection(COLLECTIONS.PRINT_JOBS)
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();

    if (jobsSnapshot.empty) {
      const failedJobs = await db
        .collection(COLLECTIONS.PRINT_JOBS)
        .where("userId", "==", userId)
        .where("status", "==", "conversion_failed")
        .limit(5)
        .get();

      if (!failedJobs.empty) {
        return sendApiError(
          res,
          409,
          {
            code: "conversion_failed_jobs",
            message: "Some uploaded files failed conversion",
            details: failedJobs.docs.map((doc) => ({
              jobId: doc.id,
              fileName: doc.data().sourceFileName || "unknown",
              reason: doc.data().conversionError || "Conversion failed",
            })),
          },
          "conversion_failed_jobs",
          "Some uploaded files failed conversion"
        );
      }

      return sendApiError(res, 400, null, "no_pending_jobs", "No pending jobs");
    }

    let totalPages = 0;
    jobsSnapshot.forEach((doc) => { totalPages += doc.data().pageCount; });

    const amount = Number((totalPages * PRICE_PER_PAGE).toFixed(2));
    const orderId = "order_" + Date.now();

    // FIX: Add timeout to prevent hangs and duplicate orders
    const response = await withTimeout(
      axios.post(
        `${CASHFREE_BASE_URL}/orders`,
        {
          order_id: orderId,
          order_amount: amount,
          order_currency: "INR",
          customer_details: {
            customer_id: userId,
            customer_email: "user@email.com",
            customer_phone: "9999999999",
          },
        },
        { headers: cashfreeHeaders }
      ),
      10000,  // 10 second timeout
      "Cashfree order creation"
    );

    const orderCreatedAtMs = nowMs();

    await db.collection(COLLECTIONS.ORDERS).add({
      orderId,
      userId,
      amount,
      status: "CREATED",
      createdAt: new Date(),
    });

    const jobsBatch = db.batch();
    jobsSnapshot.forEach((jobDoc) => {
      jobsBatch.update(jobDoc.ref, {
        orderId,
        timeline: {
          ...(jobDoc.data().timeline || undefined),
          orderCreatedAt: orderCreatedAtMs,
          paymentInitiatedAt: orderCreatedAtMs,
        },
        paymentStatus: {
          ...(jobDoc.data().paymentStatus || undefined),
          status: "initiated",
          paymentMethod: "cashfree",
          paymentGatewayResponse: {
            orderId,
            sessionId: response.data.payment_session_id,
          },
        },
      });
    });
    await jobsBatch.commit();

    await db.collection(COLLECTIONS.PAYMENT_TRANSACTIONS).add({
      transactionId: `txn_${Date.now()}`,
      userId,
      orderId,
      jobIds: jobsSnapshot.docs.map((d) => d.id),
      paymentGateway: "cashfree",
      gatewayTransactionId: null,
      orderDetails: {
        description: `Print order - ${jobsSnapshot.size} job(s)`,
        amount,
        currency: "INR",
        orderTimestamp: orderCreatedAtMs,
      },
      paymentAttempt: {
        attemptNumber: 1,
        initiatedAt: orderCreatedAtMs,
        sessionId: response.data.payment_session_id,
        paymentMethod: "cashfree",
      },
      status: "initiated",
      createdAt: orderCreatedAtMs,
      updatedAt: orderCreatedAtMs,
    });

    sendApiSuccess(res, {
      orderId,
      paymentSessionId: response.data.payment_session_id,
      amount,
    });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error(details);
    await emitOpsAlert({
      code: "order_creation_failed",
      severity: "high",
      message: "Cashfree order creation failed",
      context: { details },
    });
    sendApiError(
      res,
      500,
      { code: "order_creation_failed", message: "Order creation failed", details },
      "order_creation_failed",
      "Order creation failed"
    );
  }
});

// ================= VERIFY PAYMENT =================
app.get("/verify-payment/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const response = await axios.get(
      `${CASHFREE_BASE_URL}/orders/${orderId}`,
      { headers: cashfreeHeaders }
    );
    res.json({ order_status: response.data.order_status });
  } catch (err) {
    console.error(err);
    res.status(500).send("Verification failed");
  }
});

// ================= CASHFREE WEBHOOK =================
app.post("/cashfree-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const rawBody = req.body.toString("utf8");
    const receivedSignature = req.headers["x-webhook-signature"];
    const timestamp = req.headers["x-webhook-timestamp"];

    if (receivedSignature && timestamp) {
      const signedPayload = timestamp + rawBody;
      const expectedSignature = crypto
        .createHmac("sha256", process.env.CASHFREE_SECRET_KEY)
        .update(signedPayload)
        .digest("base64");
      if (receivedSignature !== expectedSignature) {
        console.warn("Webhook signature mismatch");
        return res.status(403).send("Invalid signature");
      }
    }

    const event = JSON.parse(rawBody);

    if (event.type === "PAYMENT_SUCCESS_WEBHOOK") {
      const orderId = event.data.order.order_id;
      const userId = event.data.customer_details.customer_id;
      const paidAtMs = nowMs();

      const orders = await db.collection(COLLECTIONS.ORDERS).where("orderId", "==", orderId).get();
      const orderBatch = db.batch();
      orders.forEach((doc) => orderBatch.update(doc.ref, { status: "PAID" }));
      await orderBatch.commit();

      const jobs = await db
        .collection(COLLECTIONS.PRINT_JOBS)
        .where("userId", "==", userId)
        .where("status", "==", "pending")
        .get();
      const jobsBatch = db.batch();
      jobs.forEach((doc) => {
        jobsBatch.update(doc.ref, {
          status: "paid",
          paymentStatus: {
            ...(doc.data().paymentStatus || undefined),
            status: "completed",
            paidAt: paidAtMs,
          },
          printStatus: {
            ...(doc.data().printStatus || undefined),
            status: "ready",
          },
          timeline: {
            ...(doc.data().timeline || undefined),
            paymentCompletedAt: paidAtMs,
          },
        });
      });
      await jobsBatch.commit();

      const txns = await db
        .collection(COLLECTIONS.PAYMENT_TRANSACTIONS)
        .where("orderId", "==", orderId)
        .where("status", "==", "initiated")
        .get();
      const txnBatch = db.batch();
      txns.forEach((txnDoc) => {
        txnBatch.update(txnDoc.ref, {
          status: "completed",
          gatewayTransactionId: event?.data?.payment?.cf_payment_id || null,
          updatedAt: paidAtMs,
        });
      });
      await txnBatch.commit();
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// ================= GENERATE PRINT CODE =================
app.get("/generate-print-code", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const snapshot = await db
      .collection("printJobs")
      .where("userId", "==", userId)
      .where("status", "==", "paid")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return sendApiError(res, 400, null, "no_paid_jobs", "No paid jobs found");
    }

    const data = snapshot.docs[0].data();

    res.json({
      printCode: data.pin || data.printCode,
      pin: data.pin || data.printCode,
      expiresAt: data.codeExpiresAt,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: { code: "print_code_fetch_failed", message: "Failed to fetch print code", details: err.message || null } });
  }
});
// ================= PRINT BY CODE =================
app.post("/get-documents-by-code", async (req, res) => {
  try {
    const { printCode, pin } = req.body;
    const now = new Date();
    const lookupPin = pin || printCode;

    if (!lookupPin) {
      return sendApiError(res, 400, null, "print_code_required", "Print code required");
    }

    const snapshot = await db
      .collection("printJobs")
      .where("pin", "==", lookupPin)
      .where("status", "==", "paid")
      .get();

    if (snapshot.empty) {
      return sendApiError(res, 404, null, "invalid_code", "Invalid code");
    }

    const validDocs = [];

    // ✅ FIX: define firstDoc FIRST
    const firstDoc = snapshot.docs[0].data();
    const userId = firstDoc.userId;

    // 🔥 fetch user
    let userName = "User";

    if (userId) {
      const userSnap = await db
        .collection("users")
        .where("id", "==", userId)
        .limit(1)
        .get();

      if (!userSnap.empty) {
        userName = userSnap.docs[0].data().username;
      }
    }

    for (const doc of snapshot.docs) {
      const data = doc.data();

      // ❌ Expired
      if (data.codeExpiresAt && new Date(data.codeExpiresAt) < now) {
        await doc.ref.update({
          printCode: null,
          codeExpiresAt: null,
          status: "expired",
          printerStatus: "Expired"
        });
        continue;
      }

      // ❌ Already printed
      if (data.isPrinted) continue;

      validDocs.push({
        id: doc.id,
        file: data.fileName, // ✅ FIX (you used wrong key before)
        copies: data.copies || 1,
        url: data.fileUrl,
      });

      // 🔄 Mark as printing
      const transitionMs = nowMs();
      await doc.ref.update({
        printerStatus: "printing",
        status: "printing",
        printStatus: {
          ...(data.printStatus || undefined),
          status: "printing",
          retrievedAt: transitionMs,
          printStartedAt: transitionMs,
        },
        timeline: {
          ...(data.timeline || undefined),
          retrievedAt: transitionMs,
          printStartedAt: transitionMs,
        },
      });
    }

    if (validDocs.length === 0) {
      return res.status(400).json({
        error: "Print code expired. Please generate a new one.",
      });
    }

    res.json({
      documents: validDocs,
      userName, // ✅ now works
    });

  } catch (err) {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ ok: false, error: { code: "documents_fetch_failed", message: "Failed to fetch documents", details: err.message || null } });
  }
});


// ================= PRINT HISTORY =================
app.get("/print-history", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const snapshot = await db
      .collection("printJobs")
      .where("userId", "==", userId)
      .get();

    const history = snapshot.docs.map((doc) => {
  const data = doc.data();
  const createdAtMs = toMillis(data.createdAt || data.timeline?.createdAt || data.timeline?.uploadedAt);
  const createdAtLabel = formatLocalDateTime(createdAtMs);

  let printerStatus = data.printerStatus || "Pending";

  if (!data.printerStatus) {
    if (data.status === "pending") printerStatus = "Pending Payment";
    else if (data.status === "paid") printerStatus = "Ready to Print";
    else if (data.status === "completed") printerStatus = "Completed";
    else if (data.status === "expired") printerStatus = "Expired";
  }

  return {
    id: doc.id,
    file: data.fileName || data.sourceFileName || "Unnamed file",
    documentName: data.fileName || data.sourceFileName || "Unnamed file",
    details: `${data.pageCount} pages`,
    cost: `₹${(data.pageCount * PRICE_PER_PAGE).toFixed(2)}`,
    status: data.status,
    printerStatus,
    printCode: data.printCode || "-",
    createdAt: createdAtMs,
    createdAtMs,
    createdAtLabel,
    date: createdAtMs,
    dateMs: createdAtMs,
    dateLabel: createdAtLabel,
  };
});

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch history");
  }
});

// ================= PRINT SUMMARY =================
app.get("/print-summary", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const snapshot = await db
      .collection("printJobs")
      .where("userId", "==", userId)
      .where("status", "==", "printing")
      .get();

    const totalPrints = snapshot.size;
    let totalPages = 0;
    let totalAmount = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      totalPages += data.pageCount || 0;
      totalAmount += (data.pageCount || 0) * PRICE_PER_PAGE;
    });

    res.json({
      totalPrints,
      totalPages,
      totalAmount: Number(totalAmount.toFixed(2)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to fetch summary");
  }
});

app.post("/mark-printed", authenticateToken, async (req, res) => {
  // FIX: Now requires authentication
  try {
    const { printCode, pin } = req.body;
    const lookupPin = pin || printCode;

    if (!lookupPin) {
      return sendApiError(res, 400, null, "print_code_required", "Print code required");
    }

    const snapshot = await db
      .collection("printJobs")
      .where("pin", "==", lookupPin)
      .get();

    if (snapshot.empty) {
      return sendApiError(res, 404, null, "jobs_not_found", "No jobs found");
    }

    const batch = db.batch();

    snapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        isPrinted: true,
        printerStatus: "completed",
        status: "completed",
      });
    });

    await batch.commit();

    res.json({ message: "Print completed successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: { code: "mark_printed_failed", message: "Failed to update print status", details: err.message || null } });
  }
});

// FIX: Rate limiter for /kiosk/print endpoint (prevent DOS, rate: 20/min per IP)
const kioskPrintLimiter = (() => {
  const store = new Map();
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000;  // 1 minute
    const maxRequests = 20;      // 20 requests per minute
    
    if (!store.has(ip)) {
      store.set(ip, []);
    }
    
    const requests = store.get(ip).filter(time => now - time < windowMs);
    
    if (requests.length >= maxRequests) {
      return res.status(429).json({ 
        error: "Too many print requests. Please wait before trying again.",
        retryAfter: Math.ceil((requests[0] + windowMs - now) / 1000)
      });
    }
    
    requests.push(now);
    store.set(ip, requests);
    next();
  };
})();

app.post("/kiosk/print", kioskPrintLimiter, async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin || String(pin).length !== 4) {
      return sendApiError(res, 400, null, "invalid_pin", "A valid 4-digit PIN is required");
    }

    if (!TEST_PRINT_MODE && !FASTAPI_PRINT_URL) {
      return sendApiError(res, 500, null, "printer_not_configured", "FASTAPI_PRINT_URL is not configured");
    }

    const snapshot = await db
      .collection("printJobs")
      .where("pin", "==", String(pin))
      .limit(1)
      .get();

    if (snapshot.empty) {
      return sendApiError(res, 404, null, "print_job_not_found", "Print job not found");
    }

    const doc = snapshot.docs[0];
    const jobData = doc.data();

    if (!jobData.fileUrl) {
      return sendApiError(res, 400, null, "missing_file_url", "Print job has no file URL");
    }

    if (jobData.status !== "paid" && jobData.status !== "printing") {
      return sendApiError(res, 400, null, "print_job_not_ready", "Print job is not ready");
    }

    await doc.ref.update({
      status: "printing",
      printerStatus: "printing",
      printedAt: new Date(),
    });

    if (TEST_PRINT_MODE) {
      await doc.ref.update({
        status: "completed",
        printerStatus: "completed",
        isPrinted: true,
        completedAt: new Date(),
        printDispatchMode: "test",
      });

      return res.json({
        message: "Print simulated in TEST_PRINT_MODE",
        pin: String(pin),
        testMode: true,
        documentName: jobData.fileName,
      });
    }

    let pdfBuffer = getCachedJobPdf(String(pin));

    if (!pdfBuffer) {
      try {
        pdfBuffer = await withTimeout(downloadJobPdf(jobData), 5000, "PDF download");
        cacheJobPdf(String(pin), pdfBuffer);
      } catch (downloadErr) {
        await doc.ref.update({ status: "paid", printerStatus: "ready" });
        return res.status(503).json({
          error: "System busy. Please retry.",
          retryAfter: 10,
          details: downloadErr.message,
        });
      }
    }

    const formData = new FormData();
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    formData.append("file", blob, jobData.fileName || `print-${pin}.pdf`);
    formData.append("pin", String(pin));

    let printResponse;
    try {
      printResponse = await withTimeout(
        fetch(FASTAPI_PRINT_URL, {
          method: "POST",
          body: formData,
        }),
        8000,
        "Printer dispatch"
      );
    } catch (printErr) {
      await doc.ref.update({ status: "paid", printerStatus: "ready" });
      return res.status(503).json({
        error: "Printer is busy. Please retry.",
        retryAfter: 5,
        details: printErr.message,
      });
    }

    const printerResponse = await printResponse.text();

    if (!printResponse.ok) {
      return res.status(502).json({
        error: "Raspberry Pi print server rejected the job",
        details: printerResponse,
      });
    }

    await doc.ref.update({
      status: "completed",
      printerStatus: "completed",
      isPrinted: true,
      completedAt: new Date(),
    });

    res.json({
      message: "Print dispatched",
      pin: String(pin),
      testMode: false,
      printerResponse,
      documentName: jobData.fileName,
    });
  } catch (err) {
    console.error(err);
    await emitOpsAlert({
      code: "kiosk_print_failed",
      severity: "high",
      message: "Failed to trigger print",
      context: { details: err.message || String(err) },
    });
    res.status(500).json({ ok: false, error: { code: "kiosk_print_failed", message: "Failed to trigger print", details: err.message || null } });
  }
});


// Test route
app.get("/download/:id", async (req, res) => {
  try {
    const docId = req.params.id;

    const docSnap = await db.collection("printJobs").doc(docId).get();

    if (!docSnap.exists) {
      return res.status(404).send("File not found");
    }

    const data = docSnap.data();

    // 🔥 EXTRACT FILE PATH FROM URL
    const filePath = data.fileUrl.split(`${bucket.name}/`)[1];

    const file = bucket.file(filePath);

    // 🔥 DOWNLOAD FROM FIREBASE STORAGE
    const [fileBuffer] = await file.download();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.fileName}"`
    );
    res.setHeader("Content-Type", "application/pdf");

    res.send(fileBuffer);

  } catch (err) {
    console.error("❌ DOWNLOAD ERROR:", err);
    res.status(500).send("Download failed");
  }
});
// ================= START =================
let server;

const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  if (!server) {
    process.exit(0);
  }

  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};

if (require.main === module) {
  server = app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("🚀 Server running");
  });

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

module.exports = app;
