require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const app = express();

// Bot tokenini environment variable'dan olish
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN environment variable is not set');
  process.exit(1);
}
const bot = new TelegramBot(token);

// Webhook URL'ni environment variable'dan olish
const webhookUrl = process.env.WEBHOOK_URL;
if (!webhookUrl) {
  console.error('WEBHOOK_URL environment variable is not set');
  process.exit(1);
}

// JSON so'rovlarni qabul qilish uchun express middleware
app.use(express.json());

// Webhook yo'li (masalan, /bot)
app.post('/bot', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Webhookni o'rnatish
bot.setWebHook(webhookUrl).then(() => {
  console.log(`Webhook successfully set to ${webhookUrl}`);
}).catch(err => {
  console.error('Error setting webhook:', err);
});

const userWarnings = {}; // Warninglarni saqlash uchun

// Forbidden va exception words
const forbiddenWords = [
  // o'zbekcha
  "jalab", "jalap", "xuet", "amdan", "dalbayop", "haromi", "sex", "jallab", "jala", "ambosh", "sikib", "kot",
  "kotbosh", "dalbayopmisiz", "nahuy", "qotoq", "qo'toq", "blyat", "qotoqbosh", "suka", "naxuy", "naxui",
  "og'zingga olgin", "poxuy", "pshnx", "pshnyx", "xaramxor", "haramxor", "poxui", "jalla", "bilat", "pizda",
  "pizdes", "pizdets", "pizdetz", "pidaraz", "xuy", "dalban", "dalpan", "yiban", "haramhor", "horomhor",
  "haromdan bolgan", "xaromi", "xaromdan", "chumo", "chumolik", "sikaman", "gandon", "gandonlik", "xuyet",
  "ittaraman", "seks", "dalbayob", "dalbayoblik", "dalbayobmisan", "xoromxor", "horomxor", "ske", "dnx", "naxxuy", 
  "nahhuy", "barsa", "barsalona", "visca",
  // inglizcha
  "fuck",
];

const exceptionWords = [
  "jamshid" // misol uchun
];

// Start tugmalari
const startButtons = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "➕ GURUHGA QO'SHISH", url: `http://t.me/Nazoratchi_serjant_bot?startgroup=new&admin=all` }],
      [{ text: "📈 Bot statikasi", callback_data: "stats" }, { text: "📜 Bot buyruqlari", callback_data: "commands" }]
    ]
  }
};

// Member message handler
async function handleMemberMessage(msg) {
  try {
    let text = msg.text?.toLowerCase() || "";

    let containsForbidden = forbiddenWords.some(word => text.includes(word));
    let isException = exceptionWords.some(word => text.includes(word));

    if (containsForbidden && !isException) {
      await warnAndRestrictUser(msg, "❗️ So'kinish taqiqlangan!", true);
    } else if (text.includes("t.me/") || text.includes("http://") || text.includes("https://") || text.includes("www.")) {
      await warnAndRestrictUser(msg, "❕ Reklama taqiqlangan!", true);
    }
  } catch (err) {
    console.error("Xatolik handleMemberMessage da:", err.message);
  }
}

// Warning va restrict qilish
async function warnAndRestrictUser(msg, warningMessage, shouldDeleteMessage = false) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  userWarnings[userId] = (userWarnings[userId] || 0) + 1;

  // Xabarni o'chiramiz (agar kerak bo'lsa)
  if (shouldDeleteMessage) {
    try {
      await bot.deleteMessage(chatId, msg.message_id);
    } catch (err) {
      console.error("Xatolik deleteMessage da:", err.message);
    }
  }

  // Ogohlantirish yuboramiz
  try {
    await bot.sendMessage(chatId, `${warningMessage} @${msg.from.username || msg.from.first_name} (${userWarnings[userId]}-ogohlantirish)`);
  } catch (err) {
    console.error("Xatolik sendMessage da:", err.message);
  }

  // 3 ta warningdan keyin 10 daqiqa mute qilish
  if (userWarnings[userId] >= 3) {
    try {
      await bot.restrictChatMember(chatId, userId, {
        permissions: {
          can_send_messages: false,
          can_send_media_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false,
        },
        until_date: Math.floor(Date.now() / 1000) + 600, // 10 daqiqa
      });
      userWarnings[userId] = 0; // qayta nolga tushuramiz
    } catch (err) {
      console.error("Xatolik restrictChatMember da:", err.message);
    }
  }
}

// Fayl URLini olish
async function getFileUrl(fileId) {
  const file = await bot.getFile(fileId);
  return `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
}

// Rasmni base64 formatga o'tkazish
async function getImageBase64(fileId) {
  const url = await getFileUrl(fileId);
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data).toString('base64');
}

// Rasmni tahlil qilish (faqat 18+ kontent uchun)
async function processImage(chatId, fileId, messageId, msg) {
  try {
    const base64Image = await getImageBase64(fileId);

    const visionResponse = await axios.post(
      `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_API_KEY}`,
      {
        requests: [
          {
            image: { content: base64Image },
            features: [
              { type: "SAFE_SEARCH_DETECTION" }
            ]
          }
        ]
      }
    );

    const responseData = visionResponse.data.responses[0];
    const safeSearch = responseData.safeSearchAnnotation || {};

    const safeSearchMap = {
      "VERY_UNLIKELY": 0,
      "UNLIKELY": 25,
      "POSSIBLE": 50,
      "LIKELY": 75,
      "VERY_LIKELY": 100
    };
    const adultScore = safeSearchMap[safeSearch.adult] || 0;
    const violenceScore = safeSearchMap[safeSearch.violence] || 0;

    // 18+ kontentni tekshirish
    if (adultScore >= 50 || violenceScore >= 25) {
      await warnAndRestrictUser(msg, "❗️ 18+ kontent taqiqlangan!", true);
    }
  } catch (error) {
    console.error("Rasm tahlilida xatolik:", error.response?.data || error.message);
  }
}

// Xabarlar tinglash
bot.on('message', async (msg) => {
  if (msg.chat.type === 'private') {
    // Privat chatda faqat start komandasi ishlaydi
    if (msg.text === '/start') {
      await bot.sendMessage(msg.chat.id,
        `👮🏻‍♂️ Salom @${msg.from.username || msg.from.first_name}!\n\nMen guruhdagi vazifalarim:\n♻️ - Reklama havolalarini tozalash\n🔞 - 18+ kontentga qarshi\n🗣 - So'kinuvchilarga 10 daqiqalik taqiq\n\n⚠️ Diqqat! Menga to'liq adminlik huquqini berishingiz kerak.`,
        startButtons
      );
    }
  } else if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    try {
      // Agar xabar matn bo'lsa, moderatorlik qilish
      if (msg.text) {
        const chatMember = await bot.getChatMember(msg.chat.id, msg.from.id);
        if (chatMember.status === 'member') {
          await handleMemberMessage(msg);
        }
      }
    } catch (err) {
      console.error("Xatolik getChatMember da:", err.message);
    }
  }
});

// Rasmlar uchun
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const photo = msg.photo[msg.photo.length - 1];

  // Agar guruh bo'lsa, avtomatik tekshirish
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    try {
      const chatMember = await bot.getChatMember(chatId, msg.from.id);
      if (chatMember.status === 'member') {
        // Avtomatik 18+ kontentni tekshirish
        await processImage(chatId, photo.file_id, msg.message_id, msg);
      }
    } catch (err) {
      console.error("Xatolik getChatMember da:", err.message);
    }
  }
});

// Stickerlar uchun
bot.on('sticker', async (msg) => {
  const chatId = msg.chat.id;
  const sticker = msg.sticker;
  const fileId = sticker.thumb ? sticker.thumb.file_id : sticker.file_id;

  // Agar guruh bo'lsa, avtomatik tekshirish
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    try {
      const chatMember = await bot.getChatMember(chatId, msg.from.id);
      if (chatMember.status === 'member') {
        // Avtomatik 18+ kontentni tekshirish
        await processImage(chatId, fileId, msg.message_id, msg);
      }
    } catch (err) {
      console.error("Xatolik getChatMember da:", err.message);
    }
  }
});

// GIFlar uchun
bot.on('animation', async (msg) => {
  const chatId = msg.chat.id;
  const animation = msg.animation;
  const fileId = animation.thumb ? animation.thumb.file_id : animation.file_id;

  // Agar guruh bo'lsa, avtomatik tekshirish
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    try {
      const chatMember = await bot.getChatMember(chatId, msg.from.id);
      if (chatMember.status === 'member') {
        // Avtomatik 18+ kontentni tekshirish
        await processImage(chatId, fileId, msg.message_id, msg);
      }
    } catch (err) {
      console.error("Xatolik getChatMember da:", err.message);
    }
  }
});

// Callback query (tugmalar uchun)
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const data = callbackQuery.data;

  try {
    if (data === "commands") {
      await bot.sendMessage(chatId, "⚠️ Bu buyruqlar faqat adminlar uchun:\n\n/clear - Guruhdagi xabarlarni tozalash.");
    } else if (data === "stats") {
      await bot.sendMessage(chatId, "Bot statistikasi hozircha mavjud emas.");
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Bu funksiya mavjud emas!" });
    }
  } catch (err) {
    console.error("Callback query xatosi:", err.message);
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Xatolik yuz berdi!" });
  }
});

// /clear buyrug'i
bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  try {
    const chatMember = await bot.getChatMember(chatId, fromId);
    if (chatMember.status === 'administrator' || chatMember.status === 'creator') {
      await bot.sendMessage(chatId, "⚡️ Xabarlarni o'chirishni boshlayapman (so'nggi 10000 ta xabar).");
      let lastMessageId = msg.message_id;
      for (let i = lastMessageId; i > lastMessageId - 10000; i--) {
        try {
          await bot.deleteMessage(chatId, i);
        } catch (error) {
          // Xatolikni e'tiborsiz qoldiramiz
        }
      }
    } else {
      await bot.sendMessage(chatId, `@${msg.from.username || msg.from.first_name}, bu buyruq faqat adminlar uchun.`);
    }
  } catch (err) {
    console.error("Xatolik /clear da:", err.message);
  }
});

// Botni guruhga admin qilish yoki adminlikni olib tashlash
bot.on('my_chat_member', async (msg) => {
  if (msg.new_chat_member.status === 'administrator') {
    await bot.sendMessage(msg.chat.id, "✅ Men guruh admini bo'ldim. Ishga tayyorman!");
  } else if (msg.new_chat_member.status === 'member') {
    await bot.sendMessage(msg.chat.id, "⚠️ Menga to'liq adminlik huquqini berishingiz kerak!");
  }
});

// Serverni ishga tushirish
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('🤖 Bot ishga tushdi...');
});





