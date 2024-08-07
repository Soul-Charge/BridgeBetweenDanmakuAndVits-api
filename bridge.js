const http = require('http');
const fs = require('fs');
const url = require('url');
const Speaker = require('speaker');
const { spawn } = require('child_process');

// 读取配置文件
let config;
try {
  const data = fs.readFileSync('./config.json', 'utf8');
  config = JSON.parse(data);
} catch (err) {
  console.error("读取配置文件出错:", err);
  process.exit(1);
}

const hostname = '127.0.0.1';
const port = config.serverPort;

// 接收到的请求的url
var RecUrl = {
  url: "",
  time: 0
};

let audioQueue = [];
let isPlaying = false;

const server = http.createServer((serverReq, res) => {
  res.statusCode = 200;

  if (RecUrl.url != serverReq.url || (Date.now() - RecUrl.time > 1000)) {
    RecUrl.url = serverReq.url;
    RecUrl.time = Date.now();

    var ttsText = url.parse(RecUrl.url, true).query.text;
    ttsText = replaceWithdict(ttsText);
    var ChangedttsText = addLanguageTags(ttsText);

    const options = {
      hostname: config.requestHost,
      port: config.requestPort,
      path: '/voice/vits?id=0&format=mp3&lang=mix&text=' + encodeURIComponent(ChangedttsText),
      method: 'GET'
    };

    audioQueue.push(options);
    processQueue();

  } else {
    console.log("请求过于频繁");
    res.end("请求过于频繁");
  }
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

function processQueue() {
  if (isPlaying || audioQueue.length === 0) return;
  isPlaying = true;

  const options = audioQueue.shift();
  const req = http.request(options, (res) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', '-',
      '-f', 's16le',
      '-acodec', 'pcm_s16le',
      '-ar', '44100',
      '-ac', '2',
      '-'
    ], {
      stdio: ['pipe', 'pipe', 'ignore']
    });

    res.pipe(ffmpeg.stdin);

    const speaker = new Speaker({
      channels: 2,
      bitDepth: 16,
      sampleRate: 44100,
    });

    ffmpeg.stdout.pipe(speaker);

    ffmpeg.on('error', (error) => {
      console.error(`发生错误: ${error.message}`);
      isPlaying = false;
      processQueue();
    });

    ffmpeg.on('close', (code) => {
      console.log(`ffmpeg 进程退出，退出码 ${code}`);
      isPlaying = false;
      processQueue();
    });
  });

  req.on('error', (error) => {
    console.error(`发生错误: ${error.message}`);
    isPlaying = false;
    processQueue();
  });

  req.end();
}

function addLanguageTags(text) {
  var chinesePattern = /[\u4E00-\u9FA5a-zA-Z]/;
  var japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/;
  var numberPattern = /[0-9]/;

  var result = "";
  var currentLanguage = null;

  for (var i = 0; i < text.length; i++) {
    var char = text[i];

    if (chinesePattern.test(char) || numberPattern.test(char)) {
      if (currentLanguage !== "ZH") {
        result += "[ZH]";
        currentLanguage = "ZH";
      }
    } else if (japanesePattern.test(char)) {
      if (currentLanguage !== "JA") {
        result += "[JA]";
        currentLanguage = "JA";
      }
    } else {
      currentLanguage = null;
    }

    result += char;

    var nextChar = text[i + 1];
    if ((currentLanguage === "ZH" && (!chinesePattern.test(nextChar) && !numberPattern.test(nextChar))) ||
        (currentLanguage === "JA" && !japanesePattern.test(nextChar))) {
      result += "[" + currentLanguage + "]";
      currentLanguage = null;
    }
  }

  if (currentLanguage === "ZH") {
    result += "[ZH]";
  } else if (currentLanguage === "JA") {
    result += "[JA]";
  }

  return result;
}

function replaceWithdict(str) {
  const dict = JSON.parse(fs.readFileSync('./dict.json', 'utf8'));

  if (!dict || Object.keys(dict).length === 0) {
    return str;
  }

  let replaced = str;
  const keys = Object.keys(dict);
  keys.sort((a, b) => b.length - a.length);

  const replacePatterns = keys.map(key => {
    const entry = dict[key];
    const pattern = new RegExp(entry.caseSensitive ? key : key.toLowerCase(), 'gi');
    return { pattern, value: entry.value };
  });

  replacePatterns.forEach(({ pattern, value }) => {
    replaced = replaced.replace(pattern, value);
  });

  return replaced;
}
