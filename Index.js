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

const USERS_FILE     = path.join(__dirname, "users.json");
const ACTIVITY_FILE  = path.join(__dirname, "activity.json");
const ORDERS_FILE    = path.join(__dirname, "orders.json");
const SESSIONS_FILE  = path.join(__dirname, "sessions.json");
const REPLIED_FILE   = path.join(__dirname, "replied.json");
const IMAGE_PATH     = path.join(__dirname, "media", "product.png");
const VIDEO_PATH     = path.join(__dirname, "media", "usage.mp4");
const OFFER_IMAGE    = path.join(__dirname, "media", "offer.png");

const TEST_NUMBER    = "212616346157@s.whatsapp.net";
const ADMIN_NUMBER   = "212616346157@s.whatsapp.net";
const REMINDER_DELAY = 24 * 60 * 60 * 1000;

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

async function markReplied(jid) {
  const data = await loadJSON(REPLIED_FILE);
  data[jid] = true;
  await saveJSON(REPLIED_FILE, data);
}

async function hasReplied(jid) {
  const data = await loadJSON(REPLIED_FILE);
  return data[jid] === true;
}

async function setSession(jid, data) {
  const sessions = await loadJSON(SESSIONS_FILE);
  sessions[jid] = data;
  await saveJSON(SESSIONS_FILE, sessions);
}

async function getSession(jid) {
  const sessions = await loadJSON(SESSIONS_FILE);
  return sessions[jid] ?? null;
}

async function clearSession(jid) {
  const sessions = await loadJSON(SESSIONS_FILE);
  delete sessions[jid];
  await saveJSON(SESSIONS_FILE, sessions);
}

async function markAsOrdered(jid) {
  const data = await loadJSON(ORDERS_FILE);
  if (!Array.isArray(data)) {
    await saveJSON(ORDERS_FILE, []);
    return;
  }
}

async function saveOrder(order) {
  const data = await loadJSON(ORDERS_FILE);
  const orders = Array.isArray(data) ? data : [];
  orders.push(order);
  await saveJSON(ORDERS_FILE, orders);
}

async function sendWelcomeMenu(sock, jid) {
  await sock.sendMessage(jid, {
    image: { url: IMAGE_PATH },
  });

  await sendInteractiveMessage(sock, jid, {
    text:
      "💰 99 درهم الدفع عند الاستلام\n" +
      "🚚 التوصيل مجاني لكل المدن المغربية\n" +
      "🛒 *للطلب يكفي تخلي لينا:*\n" +
      "الاسم:\n" +
      "رقم الهاتف:\n" +
      "العنوان:\n",
    footer: "عرض محدود",
    title: "",
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
      "⏰ *عرض استثنائي خاص اليوم فقط!*\n" +
      "💰 قطعتان بـ 99 درهم مع التوصيل مجاناً\n" +
      "🚚 الدفع عند الاستلام\n" +
      "لا تفوّت الفرصة! اختر 👇",
    footer: "عرض محدود",
    title: "",
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
      const replied = await hasReplied(jid);
      if (replied) {
        await clearActivity(jid);
        return;
      }

      const lastActive = await getActivity(jid);
      if (!lastActive) return;

      const elapsed = Date.now() - lastActive;
      if (elapsed >= REMINDER_DELAY) {
        await sendReminderOffer(sock, jid);
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
  } catch {}
  return null;
}

async function startOrderFlow(sock, jid) {
  await setSession(jid, { step: "name", name: "", phone: "", address: "" });
  await sock.sendMessage(jid, {
    text: "🛒 *سنكمل طلبك الآن!*\n\nمن فضلك أدخل *اسمك الكامل:*",
  });
}

async function handleOrderFlow(sock, jid, text, session) {
  if (session.step === "name") {
    session.name = text.trim();
    session.step = "phone";
    await setSession(jid, session);
    await sock.sendMessage(jid, {
      text: `✅ شكراً *${session.name}*!\n\nالآن أدخل *رقم هاتفك:*`,
    });
  } else if (session.step === "phone") {
    session.phone = text.trim();
    session.step = "address";
    await setSession(jid, session);
    await sock.sendMessage(jid, {
      text: "✅ تم حفظ الرقم!\n\nأدخل *عنوانك التفصيلي:*\n_(المدينة، الحي، الشارع)_",
    });
  } else if (session.step === "address") {
    session.address = text.trim();

    const order = {
      jid,
      name: session.name,
      phone: session.phone,
      address: session.address,
      date: new Date().toLocaleString("ar-MA"),
    };

    await saveOrder(order);
    await clearSession(jid);
    await clearActivity(jid);
    await markReplied(jid);

    await sock.sendMessage(jid, {
      text:
        "✅ *تم استلام طلبك بنجاح!*\n\n" +
        `👤 الاسم: ${session.name}\n` +
        `📞 الهاتف: ${session.phone}\n` +
        `📍 العنوان: ${session.address}\n\n` +
        "🚚 فريق التوصيل سيتواصل معك قريباً\n" +
        "شكراً لثقتكم 🌷",
    });

    await sock.sendMessage(ADMIN_NUMBER, {
      text:
        "🛒 *طلب جديد!*\n\n" +
        `👤 الاسم: ${session.name}\n` +
        `📞 الهاتف: ${session.phone}\n` +
        `📍 العنوان: ${session.address}\n` +
        `🕐 التاريخ: ${order.date}`,
    });
  }
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
        } catch (err) {
          console.error("خطأ في إرسال رسالة الاختبار:", err);
        }
      }
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
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
      if (!jid || jid.endsWith("@g.us")) return;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      const session = await getSession(jid);
      if (session && session.step !== "done") {
        await handleOrderFlow(sock, jid, text, session);
        return;
      }

      const users = await loadUsers();

      if (!users.includes(jid)) {
        await saveUser(jid);
        await sendWelcomeMenu(sock, jid);
        await setActivity(jid);
        scheduleReminder(sock, jid);
        return;
      }

      if (text && text.trim() !== "") {
        await markReplied(jid);
        await clearActivity(jid);
      }

      const selectedId = getSelectedId(msg);
      if (!selectedId) return;

      await markReplied(jid);
      await clearActivity(jid);

      if (selectedId === "usage") {
        await sock.sendMessage(jid, {
          video: { url: VIDEO_PATH },
          caption:
            "📖 *طريقة الاستخدام*\n\nشاهد الفيديو لمعرفة كيفية استخدام المنتج.",
        });
      } else if (selectedId === "order") {
        await startOrderFlow(sock, jid);
      }
    } catch (err) {
      console.error("خطأ في استقبال الرسائل:", err);
    }
  });
}

start();
