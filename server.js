require('dotenv').config();

const express = require('express');
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const profileRoutes = require('./routes/profile.routes');
const postsRouter = require('./routes/posts');
const tokensRouter = require("./routes/tokens");
const eventRouter = require("./routes/eventRoutes");
const advRouter = require('./routes/advRoutes');
const followRoutes = require("./routes/followRoutes");
const liveRoutes = require("./routes/liveRoutes");
const messageRoutes = require("./routes/messageRoutes");
const blockRoutes = require("./routes/blockRoutes");
const verificationRoutes = require("./routes/verificationRoutes");
const muteRoutes = require("./routes/muteRoutes");
const reportRoutes = require("./routes/reportRoutes");
const adminReportsRoutes = require("./routes/adminReportsRoutes");
const adminQueueRoutes = require("./routes/adminQueueRoutes");
const adminVerificationsRoutes = require("./routes/adminVerifications.routes");
const stripeWebhookRoutes = require("./routes/stripeWebhookRoutes");
const stripeConnectRoutes = require("./routes/stripeConnectRoutes");
const payoutRoutes = require("./routes/payoutRoutes");
const profileEventBannerRoutes = require("./routes/profileEventBannerRoutes");
const eventPromoRouter = require("./routes/eventPromoRoutes");
const searchRoutes = require("./routes/searchRoutes");
const liveSearchRoutes = require("./routes/liveSearchRoutes");
const notificationsRoutes = require("./routes/notifications");
const { router: adminRefundRoutes } = require("./routes/adminRefundRoutes");
const appSettingsRoutes = require("./routes/appSettingsRoutes");
const adminAdvRoutes = require("./routes/adminAdvRoutes");
const showcaseRoutes = require("./routes/showcaseRoutes");
const oldLiveRoutes = require("./routes/oldLiveRoutes");
const adminTrustRoutes = require("./routes/adminTrustRoutes");
const adminDictionaryRoutes = require("./routes/adminDictionaryRoutes");
const adminSearchLogsRoutes = require("./routes/adminSearchLogsRoutes");
const adminContentRoutes = require("./routes/adminContentRoutes");
const aiModerationRoutes = require("./routes/aiModerationRoutes");
const adminUsersRoutes = require("./routes/adminUsersRoutes");
const adminPayoutRoutes = require("./routes/adminPayoutRoutes");
const adminNotificationsRoutes = require("./routes/adminNotifications.routes");
const mediaRoutes = require("./routes/mediaRoutes");
const adminEconomyRoutes = require("./routes/adminEconomyRoutes");
const adminEconomyRefundRoutes = require("./routes/adminEconomyRefundRoutes");
const refundRequestRoutes = require("./routes/refundRequestRoutes");
const vipRoutes = require("./routes/vipRoutes");
const timeRoutes = require("./routes/timeRoutes");
const adminCreatorRoutes = require("./routes/adminCreatorRoutes");
const adminShowcaseRoutes = require("./routes/adminShowcaseRoutes");
const adminUpdatesRoutes = require("./routes/adminUpdatesRoutes");
const updatesRoutes = require("./routes/updatesRoutes");
const adminDashboardMetricsRoutes = require("./routes/adminDashboardMetricsRoutes");
const bugReportsRoutes = require("./routes/bugReportsRoutes");
const adminBugReportsRoutes = require("./routes/adminBugReportsRoutes");
const adminSecurityLogRoutes = require("./routes/adminSecurityLogRoutes");
const adminAgeGateRoutes = require("./routes/adminAgeGateRoutes");
const { startNativePrivateReleaseJob } = require("./jobs/nativePrivateReleaseJob");
const { startLiveHostWatchdog } = require("./services/liveHostWatchdogService");
const { startInternalPrivateReleaseJob } = require("./jobs/internalPrivateReleaseJob");

// usa direttamente i file giusti
const authRoutes = require('./routes/auth.routes');
// const outRoutes  = require('./routes/out.routes');

const app = express();

function getRequiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function getR2Client() {
  const accountId = getRequiredEnv("R2_ACCOUNT_ID");
  const accessKeyId = getRequiredEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = getRequiredEnv("R2_SECRET_ACCESS_KEY");

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

const r2BootstrapEnabled =
  !!String(process.env.R2_ACCOUNT_ID || "").trim() &&
  !!String(process.env.R2_ACCESS_KEY_ID || "").trim() &&
  !!String(process.env.R2_SECRET_ACCESS_KEY || "").trim() &&
  !!String(process.env.R2_BUCKET || "").trim();

const fs = require("fs");
const path = require("path");
const ffprobePath = require("ffprobe-static").path;

try {
  fs.chmodSync(ffprobePath, 0o755);
  console.log("ffprobe permissions fixed");
} catch (e) {
  console.error("ffprobe chmod error:", e.message);
}

// Connessione a MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connesso a MongoDB Atlas');

    if (r2BootstrapEnabled) {
      try {
        const client = getR2Client();
        await client.send(
          new PutObjectCommand({
            Bucket: process.env.R2_BUCKET,
            Key: "__healthcheck__/boot.txt",
            Body: Buffer.from(`NestX R2 bootstrap ${new Date().toISOString()}`),
            ContentType: "text/plain",
          })
        );
        console.log("✅ R2 bootstrap OK");
      } catch (e) {
        console.error("❌ R2 bootstrap failed:", e.message);
        process.exit(1);
      }
    } else {
      console.error("❌ R2 env missing");
      process.exit(1);
    }

    startNativePrivateReleaseJob();
    startInternalPrivateReleaseJob();
    startLiveHostWatchdog();
  })
  .catch((err) => {
    console.error('❌ Errore connessione MongoDB:', err.message);
    process.exit(1);
  });

app.use("/api/webhooks", stripeWebhookRoutes);

// middleware base
// middleware base
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// router
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/posts', postsRouter);
app.use("/api/tokens", tokensRouter);
app.use("/api/events", eventRouter);
app.use('/api/adv', advRouter);
app.use("/api/follow", followRoutes);
app.use("/api/live", liveRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/block", blockRoutes);
app.use("/api/verification", verificationRoutes);
app.use("/api/mute", muteRoutes);
app.use("/api/report", reportRoutes);
app.use("/api/admin", adminReportsRoutes);
app.use("/api/admin", adminQueueRoutes);
app.use("/api/admin/verifications", adminVerificationsRoutes);
app.use("/api/stripe", stripeConnectRoutes);
app.use("/api/payout", payoutRoutes);
app.use("/api/profile", profileEventBannerRoutes);
app.use("/api/events", eventPromoRouter);
app.use("/api", searchRoutes);
app.use("/api/live-search", liveSearchRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/admin", adminRefundRoutes);
app.use("/api/app-settings", appSettingsRoutes);
app.use("/api/admin", adminAdvRoutes);
app.use("/api/showcase", showcaseRoutes);
app.use("/api/profile", oldLiveRoutes);
app.use("/api/admin", adminTrustRoutes);
app.use("/api/admin", adminDictionaryRoutes);
app.use("/api/admin", adminSearchLogsRoutes);
app.use("/api/admin", adminContentRoutes);
app.use("/api/ai", aiModerationRoutes);
app.use("/api/admin", adminUsersRoutes);
app.use("/api/admin/payout", adminPayoutRoutes);
app.use("/api/admin/notifications", adminNotificationsRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/admin/economy", adminEconomyRoutes);
app.use("/api/admin/economy", adminEconomyRefundRoutes);
app.use("/api/refunds", refundRequestRoutes);
app.use("/api/vip", vipRoutes);
app.use("/api", timeRoutes);
app.use("/api/admin", adminCreatorRoutes);
app.use("/api/admin", adminShowcaseRoutes);
app.use("/api/admin", adminUpdatesRoutes);
app.use("/api/updates", updatesRoutes);
app.use("/api/admin", adminDashboardMetricsRoutes);
app.use("/api/bugreports", bugReportsRoutes);
app.use("/api/admin", adminBugReportsRoutes);
app.use("/api/admin", adminSecurityLogRoutes);
app.use("/api/admin", adminAgeGateRoutes);

// healthcheck base
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nestx-backend',
    timestamp: new Date().toISOString(),
  });
});

// rotta di healthcheck API
app.get('/api/healthcheck', (req, res) => {
  res.json({
    status: 'ok',
    service: 'nestx-backend',
    timestamp: new Date().toISOString(),
  });
});

// rotta di test semplice
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    scope: 'auth',
    message: 'auth route attiva',
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server NestX avviato su http://localhost:${PORT}`);
});
