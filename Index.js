const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

const { sendInteractiveMessage } = require("baileys_helper");

const { Boom } = require("@hapi/boom");
const fs = require("fs/promises");
const path = require("path");
const qrcode = require("qrcode-terminal");

// ──────────────────────────────────────────
// المسارات والإعدادات
// ──────────────────────────────────────────
const USERS_FILE      = path.join(__dirname, "users.json");
const ACTIVITY_FILE   = path.join(__dirname, "activity.json");
const IMAGE_PATH      = path.join(__dirname, "media", "product.png");   // ← صورة المنتج
const VIDEO_PATH      = path.join(__dirname, "media", "usage.mp4");     // ← فيديو طريقة الاستخدام
const OFFER_IMAGE     = path.join(__dirname, "media", "offer.png");     // ← صورة العرض الاستثنائي

const TEST_NUMBER     = "212708026291@s.whatsapp.net";
const REMINDER_DELAY  = 24 * 60 * 60 * 1000; // 24 ساعة بالميلي ثانية

let testSent = false;

// ──────────────────────────────────────────
// إدارة المستخدمين
// ──────────────────────────────────────────
async function loadJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function saveJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function loadUsers() {
  const data = await loadJSON(USERS_FILE);
  return Array.isArray(data) ? data : [];
}

async function saveUser(jid) {
  const users = await loadUsers();
  if (!users.includes(jid)) {
    users.push(jid);
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  }
}

// ──────────────────────────────────────────
// إدارة آخر نشاط للمستخدمين
// ──────────────────────────────────────────
async function setActivity(jid) {
  const data = await loadJSON(ACTIVITY_FILE);
  data[jid] = Date.now();
  await saveJSON(ACTIVITY_FILE, data);
}

async function getActivity(jid) {
  const data = await loadJSON(ACTIVITY_FILE);
  return data[jid] ?? null;
}

async function clearActivity(jid) {
  const data = await loadJSON(ACTIVITY_FILE);
  delete data[jid];
  await saveJSON(ACTIVITY_FILE, data);
}

// ──────────────────────────────────────────
// إرسال الرسالة الترحيبية مع صورة وأزرار
// ──────────────────────────────────────────
async function sendWelcomeMenu(sock, jid) {
  await sendInteractiveMessage(sock, jid, {
    image: { url: IMAGE_PATH },
    text:
      "👋 مرحباً بك!\n\n" +
      "💊 *اسم المنتج*\n" +
      "💰 99 درهم مع التوصيل مجاناً\n" +
      "🚚 الدفع عند الاستلام\n\n" +
      "اختر أحد الخيارات التالية 👇",
    footer: "خدمة العملاء",
    title: "عرضنا الحصري",
    interactiveButtons: [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "📖 طريقة الاستخدام",
          id: "usage",
        }),
      },
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🛒 أريد الطلب الآن",
          id: "order",
        }),
      },
    ],
  });
}

// ──────────────────────────────────────────
// إرسال عرض التذكير بعد 24 ساعة
// ──────────────────────────────────────────
async function sendReminderOffer(sock, jid) {
  await sendInteractiveMessage(sock, jid, {
    image: { url: OFFER_IMAGE },
    text:
      "⏰ *عرض استثنائي خاص اليوم فقط!*\n\n" +
      "💊 *اسم المنتج*\n" +
      "💰 99 درهم مع التوصيل مجاناً\n" +
      "🚚 الدفع عند الاستلام\n\n" +
      "لا تفوّت الفرصة! اختر 👇",
    footer: "عرض محدود",
    title: "🔥 عرض اليوم فقط",
    interactiveButtons: [
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "📖 طريقة الاستخدام",
          id: "usage",
        }),
      },
      {
        name: "quick_reply",
        buttonParamsJson: JSON.stringify({
          display_text: "🛒 أريد الطلب الآن",
          id: "order",
        }),
      },
    ],
  });
}

// ──────────────────────────────────────────
// جدولة تذكير 24 ساعة
// ──────────────────────────────────────────
function scheduleReminder(sock, jid) {
  setTimeout(async () => {
    try {
      // تحقق أن المستخدم لم يتفاعل منذ آخر نشاط
      const lastActive = await getActivity(jid);
      if (!lastActive) return; // تفاعل أو تم إلغاء التذكير

      const elapsed = Date.now() - lastActive;
      if (elapsed >= REMINDER_DELAY) {
        await sendReminderOffer(sock, jid);
        console.log("⏰ تم إرسال التذكير إلى:", jid);
        await clearActivity(jid);
      }
    } catch (err) {
      console.error("❌ خطأ في إرسال التذكير:", err);
    }
  }, REMINDER_DELAY);
}

// ──────────────────────────────────────────
// استخراج ID الزر المضغوط
// ──────────────────────────────────────────
function getSelectedId(msg) {
  try {
    const paramsJson =
      msg.message?.interactiveResponseMessage
        ?.nativeFlowResponseMessage?.paramsJson;
    if (paramsJson) {
      return JSON.parse(paramsJson)?.id ?? null;
    }
  } catch {
    // تجاهل
  }
  return null;
}

// ──────────────────────────────────────────
// الدالة الرئيسية
// ──────────────────────────────────────────
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    browser: ["WelcomeBot", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  // ── إدارة الاتصال ──
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 امسح QR التالي:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ البوت متصل");

      if (!testSent) {
        testSent = true;
        try {
          await sendWelcomeMenu(sock, TEST_NUMBER);
          console.log("📨 تم إرسال رسالة الاختبار إلى:", TEST_NUMBER);
        } catch (err) {
          console.error("❌ خطأ في إرسال رسالة الاختبار:", err);
        }
      }
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("❌ انقطع الاتصال، الكود:", code);
      if (shouldReconnect) {
        console.log("🔄 جاري إعادة الاتصال...");
        start();
      } else {
        console.log("🚪 تم تسجيل الخروج. احذف مجلد auth وأعد التشغيل.");
      }
    }
  });

  // ── معالجة الرسائل الواردة ──
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg?.message) return;
      if (msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      if (!jid) return;
      if (jid.endsWith("@g.us")) return;

      const users = await loadUsers();

      // ── مستخدم جديد ──
      if (!users.includes(jid)) {
        await saveUser(jid);
        await sendWelcomeMenu(sock, jid);
        await setActivity(jid);
        scheduleReminder(sock, jid);
        console.log("👋 تم إرسال الترحيب إلى:", jid);
        return;
      }

      // ── استخراج الخيار ──
      const selectedId = getSelectedId(msg);

      // تجاهل الرسائل النصية العادية التي ليست أزرار
      if (!selectedId) return;

      // المستخدم تفاعل → إلغاء التذكير
      await clearActivity(jid);

      // ── طريقة الاستخدام → فيديو ──
      if (selectedId === "usage") {
        await sock.sendMessage(jid, {
          video: { url: VIDEO_PATH },
          caption:
            "📖 *طريقة الاستخدام*\n\n" +
            "شاهد الفيديو التالي لمعرفة كيفية استخدام المنتج بشكل صحيح.",
        });
      }

      // ── الطلب ──
      else if (selectedId === "order") {
        await sock.sendMessage(jid, {
          text:
            "🛒 *لإتمام طلبك يكفي أن ترسل لنا:*\n\n" +
            "الاسم:\nرقم الهاتف:\nالعنوان:\n\n" +
            "🚚 فريق التوصيل سيتواصل معك في أقرب وقت.\n" +
            "💳 الدفع عند الاستلام — التوصيل مجاناً\n\n" +
            "شكراً لثقتكم 🌷",
        });
      }

    } catch (err) {
      console.error("❌ خطأ في استقبال الرسائل:", err);
    }
  });
}

start();
