require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { promisify } = require("node:util");
const { OAuth2Client } = require("google-auth-library");
const crypto = require("node:crypto");
const libre = require("libreoffice-convert");
const { db, bucket } = require("./firebase");

const libreConvert = promisify(libre.convert);

const FASTAPI_PRINT_URL = process.env.FASTAPI_PRINT_URL || process.env.NEXT_PUBLIC_FASTAPI_PRINT_URL;
const TEST_PRINT_MODE = String(process.env.TEST_PRINT_MODE || "").toLowerCase() === "true";

const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
]);

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

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pdfCache.entries()) {
    if (value.expiry < now) {
      pdfCache.delete(key);
    }
  }
}, 5 * 60 * 1000);

const cacheJobPdf = (pin, buffer) => {
  pdfCache.set(pin, {
    buffer,
    expiry: Date.now() + PDF_CACHE_TTL,
  });
};

const getCachedJobPdf = (pin) => {
  const cached = pdfCache.get(pin);
  if (!cached) return null;
  if (cached.expiry < Date.now()) {
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
app.use(express.json({ limit: "100mb" }));
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });
const SECRET_KEY = process.env.JWT_SECRET;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.get("/", (_req, res) => {
  res.status(200).send("mimo backend running");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ================= CASHFREE =================
const CASHFREE_BASE_URL = "https://sandbox.cashfree.com/pg";
const cashfreeHeaders = {
  "Content-Type": "application/json",
  "x-client-id": process.env.CASHFREE_APP_ID,
  "x-client-secret": process.env.CASHFREE_SECRET_KEY,
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
    const existing = await db.collection("users").where("email", "==", email).get();
    if (!existing.empty) {
      return res.status(400).send("User already exists");
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.collection("users").add({
      id: uuidv4(),
      username,
      password: hashedPassword,
      email,
      mobileNumber,
      googleUser: false,
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
    const snapshot = await db.collection("users").where("email", "==", email).get();
    let userId;
    if (snapshot.empty) {
      userId = uuidv4();
      await db.collection("users").add({
        id: userId,
        username: name,
        email,
        password: null,
        mobileNumber: "",
        googleUser: true,
      });
    } else {
      const doc = snapshot.docs[0];
      // Fall back to Firestore doc ID if custom id field is missing
      userId = doc.data().id || doc.id;
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
    res.json(user.settings || {});
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
    const now = new Date();

    const snapshot = await db
      .collection("printJobs")
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();

    if (snapshot.empty) {
      return res.status(400).json({ error: "No pending jobs found" });
    }

    const pin = await generateUniquePin();
    const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    const batch = db.batch();

    snapshot.forEach((doc) => {
      batch.update(doc.ref, {
        status: "paid",
        pin,
        printCode: pin,
        codeCreatedAt: now,
        codeExpiresAt: expiresAt,
        isPrinted: false,
        printerStatus: "ready",
      });
    });

    await batch.commit();

    res.json({
      message: "Payment success",
      pin,
      printCode: pin,
    });

    setImmediate(async () => {
      try {
        const paidJobs = await db
          .collection("printJobs")
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
    res.status(500).json({ error: "Payment update failed" });
  }
});

// ================= UPLOAD =================
app.post("/upload", authenticateToken, upload.array("files"), async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) return res.status(401).send("User ID missing from token");

    if (!req.files || req.files.length === 0) {
      return res.status(400).send("At least one file is required");
    }

    const invalidFile = req.files.find((file) => !isSupportedUpload(file));
    if (invalidFile) {
      return res.status(400).send("Supported files: PDF, DOC, DOCX, TXT, JPG, JPEG, PNG");
    }

    // Clear old pending jobs
    const oldJobs = await db
      .collection("printJobs")
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();
    for (let doc of oldJobs.docs) {
      await doc.ref.delete();
    }

    const oldConversionJobs = await db
      .collection("printJobs")
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

      await db.collection("printJobs").add({
        userId,
        sourceFileName: file.originalname,
        fileUrl: `gs://${bucket.name}/${fileName}`,
        status: "pending_conversion",
        createdAt: new Date(),
      });
    });

    await Promise.all(uploadPromises);

    const estimatedPages = req.files.length * 5;
    const estimatedAmount = Number((estimatedPages * 2.3).toFixed(2));

    return res.json({
      message: "Files queued for processing",
      filesUploaded: req.files.length,
      estimatedPages,
      estimatedAmount,
      status: "processing",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Upload failed");
  }
});

app.post("/internal/process-conversions", async (_req, res) => {
  try {
    const snapshot = await db
      .collection("printJobs")
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

      await jobDoc.ref.update({
        fileName: outputFileName,
        pageCount,
        fileUrl: `gs://${bucket.name}/${convertedFileName}`,
        status: "pending",
        conversionCompletedAt: new Date(),
      });

      return res.json({ processed: 1, jobId: jobDoc.id, pageCount });
    } catch (conversionErr) {
      await jobDoc.ref.update({
        status: "conversion_failed",
        conversionError: conversionErr.message,
        failedAt: new Date(),
      });
      return res.status(500).json({ processed: 0, error: "Conversion failed" });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to process conversions" });
  }
});

// ================= HELPER: PROCESS ALL PENDING CONVERSIONS FOR USER =================
const processPendingConversionsForUser = async (userId) => {
  const jobs = await db
    .collection("printJobs")
    .where("userId", "==", userId)
    .where("status", "==", "pending_conversion")
    .get();

  for (let doc of jobs.docs) {
    const jobData = doc.data();
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

      await doc.ref.update({
        fileName: outputFileName,
        pageCount,
        fileUrl: `gs://${bucket.name}/${convertedFileName}`,
        status: "pending",
        conversionCompletedAt: new Date(),
      });
    } catch (conversionErr) {
      await doc.ref.update({
        status: "conversion_failed",
        conversionError: conversionErr.message,
        failedAt: new Date(),
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
      .collection("printJobs")
      .where("userId", "==", userId)
      .where("status", "==", "pending")
      .get();

    if (jobsSnapshot.empty) return res.status(400).send("No pending jobs");

    let totalPages = 0;
    jobsSnapshot.forEach((doc) => { totalPages += doc.data().pageCount; });

    const amount = Number((totalPages * 2.3).toFixed(2));
    const orderId = "order_" + Date.now();

    const response = await axios.post(
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
    );

    await db.collection("orders").add({
      orderId,
      userId,
      amount,
      status: "CREATED",
      createdAt: new Date(),
    });

    res.json({
      orderId,
      paymentSessionId: response.data.payment_session_id,
      amount,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Order creation failed");
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

      const orders = await db.collection("orders").where("orderId", "==", orderId).get();
      const orderBatch = db.batch();
      orders.forEach((doc) => orderBatch.update(doc.ref, { status: "PAID" }));
      await orderBatch.commit();

      const jobs = await db
        .collection("printJobs")
        .where("userId", "==", userId)
        .where("status", "==", "pending")
        .get();
      const jobsBatch = db.batch();
      jobs.forEach((doc) => jobsBatch.update(doc.ref, { status: "paid" }));
      await jobsBatch.commit();
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
      return res.status(400).json({ error: "No paid jobs found" });
    }

    const data = snapshot.docs[0].data();

    res.json({
      printCode: data.pin || data.printCode,
      pin: data.pin || data.printCode,
      expiresAt: data.codeExpiresAt,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch print code" });
  }
});
// ================= PRINT BY CODE =================
app.post("/get-documents-by-code", async (req, res) => {
  try {
    const { printCode, pin } = req.body;
    const now = new Date();
    const lookupPin = pin || printCode;

    if (!lookupPin) {
      return res.status(400).json({ error: "Print code required" });
    }

    const snapshot = await db
      .collection("printJobs")
      .where("pin", "==", lookupPin)
      .where("status", "==", "paid")
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "Invalid code" });
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
      await doc.ref.update({
        printerStatus: "printing",
        status: "printing",
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
    res.status(500).json({ error: "Failed to fetch documents" });
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

  let printerStatus = data.printerStatus || "Pending";

  if (!data.printerStatus) {
    if (data.status === "pending") printerStatus = "Pending Payment";
    else if (data.status === "paid") printerStatus = "Ready to Print";
    else if (data.status === "completed") printerStatus = "Completed";
    else if (data.status === "expired") printerStatus = "Expired";
  }

  return {
    id: doc.id,
    file: data.fileName,
    details: `${data.pageCount} pages`,
    cost: `₹${(data.pageCount * 2.3).toFixed(2)}`,
    status: data.status,
    printerStatus,                 // ✅ ADD THIS
    printCode: data.printCode || "-",
    date: data.createdAt
      ? new Date(data.createdAt.toDate()).toLocaleString()
      : "N/A",
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
      totalAmount += (data.pageCount || 0) * 2.3;
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

app.post("/mark-printed", async (req, res) => {
  try {
    const { printCode, pin } = req.body;
    const lookupPin = pin || printCode;

    if (!lookupPin) {
      return res.status(400).json({ error: "Print code required" });
    }

    const snapshot = await db
      .collection("printJobs")
      .where("pin", "==", lookupPin)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "No jobs found" });
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
    res.status(500).json({ error: "Failed to update print status" });
  }
});

app.post("/kiosk/print", async (req, res) => {
  try {
    const { pin } = req.body;

    if (!pin || String(pin).length !== 4) {
      return res.status(400).json({ error: "A valid 4-digit PIN is required" });
    }

    if (!TEST_PRINT_MODE && !FASTAPI_PRINT_URL) {
      return res.status(500).json({ error: "FASTAPI_PRINT_URL is not configured" });
    }

    const snapshot = await db
      .collection("printJobs")
      .where("pin", "==", String(pin))
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "Print job not found" });
    }

    const doc = snapshot.docs[0];
    const jobData = doc.data();

    if (!jobData.fileUrl) {
      return res.status(400).json({ error: "Print job has no file URL" });
    }

    if (jobData.status !== "paid" && jobData.status !== "printing") {
      return res.status(400).json({ error: "Print job is not ready" });
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
    res.status(500).json({ error: "Failed to trigger print" });
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
if (require.main === module) {
  app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("🚀 Server running");
  });
}

module.exports = app;