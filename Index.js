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

const USERS_FILE      = path.join(__dirname, "users.json");
const ACTIVITY_FILE   = path.join(__dirname, "activity.json");
const IMAGE_PATH      = path.join(__dirname, "media", "product.png");
const VIDEO_PATH      = path.join(__dirname, "media", "usage.mp4");
const OFFER_IMAGE     = path.join(__dirname, "media", "offer.png");

const TEST_NUMBER     = "212616346157@s.whatsapp.net";
const REMINDER_DELAY  = 24 * 60 * 60 * 1000;

let testSent = false;

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

async function sendWelcomeMenu(sock, jid) {
  await sock.sendMessage(jid, {
    image: { url: IMAGE_PATH },
  });

  await sendInteractiveMessage(sock, jid, {
    text:
      "💊 *اسم المنتج*\n" +
      "💰 99 درهم مع التوصيل مجاناً\n" +
      "🚚 الدفع عند الاستلام\n\n" +
      "🛒 *للطلب يكفي تخلي لينا:*\n\n" +
      "الاسم:\n" +
      "رقم الهاتف:\n" +
      "العنوان:\n\n" +
      "🚚 فريق التوصيل سيتواصل معك في أقرب وقت.\n" +
      "شكراً لثقتكم 🌷",
    footer: "خدمة العملاء",
    title: "🌟 مرحباً بك",
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

function scheduleReminder(sock, jid) {
  setTimeout(async () => {
    try {
      const lastActive = await getActivity(jid);
      if (!lastActive) return;

      const elapsed = Date.now() - lastActive;
      if (elapsed >= REMINDER_DELAY) {
        await sendReminderOffer(sock, jid);
        console.log("تم إرسال التذكير إلى:", jid);
        await clearActivity(jid);
      }
    } catch (err) {
      console.error("خطأ في إرسال التذكير:", err);
    }
  }, REMINDER_DELAY);
}

function getSelectedId(msg) {
  try {
    const paramsJson =
      msg.message?.interactiveResponseMessage
        ?.nativeFlowResponseMessage?.paramsJson;
    if (paramsJson) {
      return JSON.parse(paramsJson)?.id ?? null;
    }
  } catch {
  }
  return null;
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    browser: ["WelcomeBot", "Chrome", "1.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("البوت متصل");

      if (!testSent) {
        testSent = true;
        try {
          await sendWelcomeMenu(sock, TEST_NUMBER);
          console.log("تم إرسال رسالة الاختبار إلى:", TEST_NUMBER);
        } catch (err) {
          console.error("خطأ في إرسال رسالة الاختبار:", err);
        }
      }
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log("انقطع الاتصال، الكود:", code);
      if (shouldReconnect) {
        console.log("جاري إعادة الاتصال...");
        start();
      } else {
        console.log("تم تسجيل الخروج. احذف مجلد auth وأعد التشغيل.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];

      if (!msg?.message) return;
      if (msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      if (!jid) return;
      if (jid.endsWith("@g.us")) return;

      const users = await loadUsers();

      if (!users.includes(jid)) {
        await saveUser(jid);
        await sendWelcomeMenu(sock, jid);
        await setActivity(jid);
        scheduleReminder(sock, jid);
        console.log("تم إرسال الترحيب إلى:", jid);
        return;
      }

      const selectedId = getSelectedId(msg);

      if (!selectedId) return;

      await clearActivity(jid);

      if (selectedId === "usage") {
        await sock.sendMessage(jid, {
          video: { url: VIDEO_PATH },
          caption:
            "📖 *طريقة الاستخدام*\n\n" +
            "شاهد الفيديو التالي لمعرفة كيفية استخدام المنتج بشكل صحيح.",
        });
      } else if (selectedId === "order") {
        await sock.sendMessage(jid, {
          text:
            "🛒 *للطلب يكفي تخلي لينا:*\n\n" +
            "الاسم:\n" +
            "رقم الهاتف:\n" +
            "العنوان:\n\n" +
            "🚚 فريق التوصيل سيتواصل معك في أقرب وقت.\n" +
            "شكراً لثقتكم 🌷",
        });
      }

    } catch (err) {
      console.error("خطأ في استقبال الرسائل:", err);
    }
  });
}

start();
