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

const WELCOME_TEXT = "👋 مرحباً، شكراً لتواصلك معنا.";

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
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  }
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    browser: ["WelcomeBot", "Chrome", "1.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // ✅ QR الحقيقي
    if (qr) {
      console.log("\n📱 امسح QR التالي من واتساب:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ البوت متصل");

      if (!testSent) {
        testSent = true;

        await sock.sendMessage(TEST_NUMBER, {
          text: "🧪 البوت يعمل بنجاح ✅"
        });

        console.log("📨 تم إرسال اختبار");
      }
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      console.log("❌ انقطع الاتصال");

      if (shouldReconnect) start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    if (jid.endsWith("@g.us")) return;

    const users = await loadUsers();

    if (!users.includes(jid)) {
      await saveUser(jid);

      await sock.sendMessage(jid, {
        text: WELCOME_TEXT
      });
    }
  });
}

start();
