require("dotenv").config();
import TelegramBot from "node-telegram-bot-api";
import { GoogleGenerativeAI } from "@google/generative-ai";

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// /start komandasi
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Salom!!!");
});

// /help komandasi
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText =
    "🤖 *AI asosidagi Telegram yordamchi bot*\n\n" +
    "\n*Foydalanish uchun buyruqlar:*\n" +
    "/start — Botni ishga tayyorlash\n" +
    "/help — Yo‘riqnoma bilan tanishish\n" +
    "\nBog‘lanish uchun: https://t.me/Usmonov_Fazliddin2004";

  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// Barcha xabarlar
bot.on("message", async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  if (text.startsWith("/start") || text.startsWith("/help")) return;

  try {
    bot.sendChatAction(chatId, "typing");

    const result = await model.generateContent(text);
    let reply = result.response.text();

    reply = reply.replace(/[*_~`<>]/g, "");

    bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Xatolik yuz berdi, keyinroq urinib ko‘ring.");
  }
});
