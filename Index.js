const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");

const USERS_FILE = path.join(__dirname, "users.json");
const IMAGE_PATH = path.join(__dirname, "welcome.jpg");

const TEST_NUMBER = "212708026291@s.whatsapp.net";

const WELCOME_TEXT = `
👋 مرحباً بك

شكراً لتواصلك معنا.
تم استلام رسالتك وسنقوم بالرد عليك في أقرب وقت ممكن.

🌹 نتمنى لك يوماً سعيداً.
`;

let testSent = false;

async function loadUsers() {
  try {
    return JSON.parse(await fs.readFile(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function saveUser(jid) {
  const users = await loadUsers();

  if (!users.includes(jid)) {
    users.push(jid);

    await fs.writeFile(
      USERS_FILE,
      JSON.stringify(users, null, 2)
    );
  }
}

async function sendWelcome(sock, jid) {
  try {
    if (fsSync.existsSync(IMAGE_PATH)) {
      await sock.sendMessage(jid, {
        image: fsSync.readFileSync(IMAGE_PATH),
        caption: WELCOME_TEXT
      });
    } else {
      console.log("⚠️ الصورة غير موجودة:", IMAGE_PATH);

      await sock.sendMessage(jid, {
        text: WELCOME_TEXT
      });
    }
  } catch (err) {
    console.error("❌ فشل إرسال الترحيب:", err);
  }
}

async function start() {
  const { state, saveCreds } =
    await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    browser: ["WelcomeBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📱 امسح QR التالي:\n");

      qrcode.generate(qr, {
        small: true
      });
    }

    if (connection === "open") {
      console.log("✅ البوت متصل");

      if (!testSent) {
        testSent = true;

        await sendWelcome(sock, TEST_NUMBER);

        console.log(
          "📨 تم إرسال رسالة الترحيب التجريبية"
        );
      }
    }

    if (connection === "close") {
      const code =
        new Boom(lastDisconnect?.error)
          ?.output?.statusCode;

      const shouldReconnect =
        code !== DisconnectReason.loggedOut;

      console.log("❌ انقطع الاتصال");

      if (shouldReconnect) {
        start();
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

      // تجاهل المجموعات
      if (jid.endsWith("@g.us")) return;

      const users = await loadUsers();

      // أول رسالة من المستخدم
      if (!users.includes(jid)) {
        await saveUser(jid);

        await sendWelcome(sock, jid);

        console.log(
          "👋 تم إرسال الترحيب إلى:",
          jid
        );
      }
    } catch (err) {
      console.error(
        "❌ خطأ في استقبال الرسائل:",
        err
      );
    }
  });
}

start();
