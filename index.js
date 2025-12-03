require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fetch = require("node-fetch");

// Telegram bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Gemini model
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// --- Yordamchi: Wikipedia summary dan viloyatlar sonini olish ---
async function getRegionsFact() {
  try {
    // Wikipedia summary sahifasini olish (Regions_of_Uzbekistan sahifasi)
    const resp = await fetch(
      "https://en.wikipedia.org/api/rest_v1/page/summary/Regions_of_Uzbekistan"
    );
    if (!resp.ok) throw new Error("Wikipedia fetch failed");
    const json = await resp.json();
    // json.extract da qisqacha ma'lumot bo'ladi, shu matndan 12/13 kabi raqamni qidiramiz
    const text = (json.extract || "").toString();

    // Oddiy tekshiruv: "12 regions" yoki "12 regions" variatsiyalarini izlash
    const m12 = text.match(/(\b12\b).*(region|regions|viloyat)/i);
    const m13 = text.match(/(\b13\b).*(region|regions|viloyat)/i);

    // Agar aniq raqam topilsa, shu matnni qaytaramiz
    if (m12) return {source: "Wikipedia", text, count: 12};
    if (m13) return {source: "Wikipedia", text, count: 13};

    // Agar aniq topilmasa, ham extract ni qaytaramiz (model bilan tekshirish uchun)
    return {source: "Wikipedia", text, count: null};
  } catch (err) {
    console.error("getRegionsFact error:", err);
    return {source: "Wikipedia", text: null, count: null, error: true};
  }
}

// /start komandasi
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Salom! Men ChatGPT botman va Fazliddin Usmonov tomonidan yaratilganman. Savolingizni yozing 👇"
  );
});

// /help komandasi
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// Yordamchi: matnda viloyatlar/region haqida so'rov borligini tekshiruvchi regex
function asksAboutRegions(text) {
  if (!text) return false;
  return /nechta\s+(viloyat|region|viloyatlar|regionlar)/i.test(text) ||
         /(viloyatlar)?\s+soni\s+nechta/i.test(text) ||
         /how many\s+regions/i.test(text);
}

// Ovozli habarni qayta ishlash
bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;

  try {
    bot.sendChatAction(chatId, "typing");

    // 1. Telegramdan ovoz faylini olish
    const fileId = msg.voice.file_id;
    const fileUrl = await bot.getFileLink(fileId);

    // 2. Audio faylni bufferga yuklash
    const res = await fetch(fileUrl);
    const audioBuffer = await res.buffer();

    // 3. Ovoz → Faqat MATN (qat'iy prompt)
    const transcriptResult = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: audioBuffer.toString("base64"),
                mimeType: msg.voice.mime_type || "audio/ogg",
              },
            },
            {
              text: `
Siz faqat OVOZ TRANSKRIPTORISIZ.
Qoidalar:
- Ovozdagi so'zlarni aynan qanday eshitilsa, so'zma-so'z yozing.
- Hech qanday izoh, tarjima yoki qo'shimcha jumla yozmang.
- Faqat ovozdan eshitilgan MATNni qaytaring.
`
            }
          ]
        }
      ]
    });

    const transcript = transcriptResult.response.text().trim();

    // 4. Foydalanuvchiga transkripni yuborish
    await bot.sendMessage(chatId, `🔊 Ovoz matni:\n${transcript}`);

    // 5. Agar transkript fakt tekshiruv talab qilsa (masalan: nechta viloyat)
    let factNote = null;
    if (asksAboutRegions(transcript)) {
      const fact = await getRegionsFact();
      if (fact && fact.count) {
        // Agar aniq raqam topilsa, avval shu ishonchli faktni yuboramiz
        await bot.sendMessage(
          chatId,
          `📌 Manba: ${fact.source}. Hozirgi ma'lumotga ko'ra O'zbekistonda *${fact.count}* birlamchi ma'muriy birlik mavjud (masalan: 12 + Qoraqalpogʻiston va Toshkent shahri kontekstida tushuncha farq qiladi).`,
          { parse_mode: "Markdown" }
        );
        factNote = `Manbadan topilgan ma'lumot: ${fact.count} (source: ${fact.source}).`;
      } else if (fact && fact.text) {
        // Manba mavjud lekin aniq raqam topilmadi — manbaning extractini yuborish
        await bot.sendMessage(
          chatId,
          `📌 Manba (qisqacha):\n${fact.text}`
        );
        factNote = `Manba: ${fact.source} (extract berildi).`;
      } else {
        // Manba olinmadi
        await bot.sendMessage(chatId, `⚠️ Fakt-tekshiruvi mumkin emas — manba topilmadi.`);
        factNote = null;
      }
    }

    // 6. Endi AIga transkript va (agar mavjud bo'lsa) fakt-note bilan so'rov yuborish
    // Modelga: avval factNote ni ko'rsatamiz, shunda u notog'ri javob bermasligi kerak
    const aiPromptParts = [];
    if (factNote) {
      aiPromptParts.push({ text: `Eslatma (fact-check): ${factNote}` });
    }
    aiPromptParts.push({ text: `Foydalanuvchi ovozidan olingan matn: "${transcript}". Iltimos, shu matnga mos aniq va tushunarli javob bering.` });

    const aiResult = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: aiPromptParts
        }
      ]
    });

    let aiReply = aiResult.response.text();
    aiReply = aiReply.replace(/[*_~`<>]/g, "");

    await bot.sendMessage(chatId, `\n🤖 AI javobi:\n${aiReply}`);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Ovozli xabarni o‘qishda xatolik yuz berdi. Iltimos qaytadan urinib ko‘ring!");
  }
});

// Matnli xabarlarni qayta ishlash
bot.on("message", async (msg) => {
  const text = msg.text;
  const chatId = msg.chat.id;

  // Voice yoki komandalar bo'lsa — bekor qilamiz
  if (!text || text.startsWith("/start") || text.startsWith("/help")) return;

  try {
    bot.sendChatAction(chatId, "typing");

    // Agar matn viloyatlar haqida so'rasa — avval faktni tekshirish
    let factNote = null;
    if (asksAboutRegions(text)) {
      const fact = await getRegionsFact();
      if (fact && fact.count) {
        await bot.sendMessage(
          chatId,
          `📌 Manba: ${fact.source}. Hozirgi ma'lumotga ko'ra: *${fact.count}*.`,
          { parse_mode: "Markdown" }
        );
        factNote = `Manbadan topilgan ma'lumot: ${fact.count} (source: ${fact.source}).`;
      } else if (fact && fact.text) {
        await bot.sendMessage(chatId, `📌 Manba (qisqacha):\n${fact.text}`);
        factNote = `Manba: ${fact.source} (extract berildi).`;
      } else {
        await bot.sendMessage(chatId, `⚠️ Fakt-tekshiruvi amalga oshmadi — manba topilmadi.`);
        factNote = null;
      }
    }

    // Modelga yuboriladigan so'rovni tayyorlash
    const parts = [];
    if (factNote) parts.push({ text: `Eslatma (fact-check): ${factNote}` });
    parts.push({ text });

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts
        }
      ]
    });

    let reply = result.response.text();
    reply = reply.replace(/[*_~`<>]/g, "");

    bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Xatolik yuz berdi, keyinroq urinib ko‘ring.");
  }
});
