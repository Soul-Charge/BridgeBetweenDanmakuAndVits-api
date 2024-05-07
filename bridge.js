const http = require('http');
const fs = require('fs');
const url = require('url');
const Speaker = require('speaker');
const { spawn } = require('child_process');
const { receiveMessageOnPort } = require('worker_threads');

const hostname = '127.0.0.1';
const port = 3000

// 接收到的请求的url
var RecUrl = {
  url:"",
  time:0
}

const server = http.createServer((serverReq, res) => {
  res.statusCode = 200;

  // 如果当前请求的url和上一次请求的url不同，并且时间间隔超过一秒
  if (RecUrl.url != serverReq.url || (Date.now() - RecUrl.time > 1000)) {
    // 则保留这次请求，记录url与时间戳
    RecUrl.url = serverReq.url;
    RecUrl.time = Date.now();
    // DEBUG
    console.log("url:" + RecUrl.url);
    console.log(RecUrl.time);

    // 解析请求中的ttsText
    var ttsText = url.parse(RecUrl.url, true).query.text;
    //此处可以加一个字典转换，按照字典的设置把一些词汇转换
    ttsText = replaceWithdict(ttsText);

    // 调用语言识别函数添加语言标记
    var ChangedttsText = addLanguageTags(ttsText);
    // DEBUG
    console.log(ttsText);
    console.log(ChangedttsText);
    // 接下来只要发起请求......等等，我发起请求得到语音然后干嘛？
    // 还能干嘛你个蠢蛋，念出来啊，弹幕姬不就是获取弹幕然后念出来吗，既然得到语音了那就念啊！
    const options = {
      hostname: '192.168.10.8',
      port: 23456,
      path: '/voice/vits?id=0&format=mp3&lang=mix&text=' + encodeURIComponent(ChangedttsText),
      method: 'GET'
    };
    // 发起请求，并将响应数据传递到标准输入
    // ffmpeg从标准输入读取数据转为pcm格式后输出到标准输出
    const req = http.request(options, (res) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', '-',           // 从标准输入读取数据
        '-f', 's16le',       // 输出为 PCM 格式
        '-acodec', 'pcm_s16le', // PCM 编码格式
        '-ar', '44100',      // 采样率
        '-ac', '2',          // 声道数
        '-',                 // 输出到标准输出
      ], {
        stdio: ['pipe', 'pipe', 'ignore'] // 忽略 stderr 输出
      });

      // 直接将 HTTP 请求的响应流通过管道传递给 ffmpeg
      res.pipe(ffmpeg.stdin);

      // 创建一个新的Speaker实例
      const speaker = new Speaker({
        channels: 2,          // 2 通道（立体声）
        bitDepth: 16,         // 每个样本的位数
        sampleRate: 44100,    // 样本率
      });
      // 将 ffmpeg 的输出通过管道传递给 Speaker
      ffmpeg.stdout.pipe(speaker);

      // 监听错误事件
      ffmpeg.on('error', (error) => {
        console.error(`发生错误: ${error.message}`);
      });

      // 监听关闭事件
      ffmpeg.on('close', (code) => {
        console.log(`ffmpeg 进程退出，退出码 ${code}`);
      });
    });

    req.on('error', (error) => {
      console.error(`发生错误: ${error.message}`);
    });
    req.end();

  } else {
    console.log("请求过于频繁");
  }
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

function addLanguageTags(text) {
    // 匹配中文字符的正则表达式
    var chinesePattern = /[\u4E00-\u9FA5a-zA-Z]/
    
    // 匹配日文字符的正则表达式
    var japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/;

    // 匹配数字字符的正则表达式
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
            // 非中文、日文和数字字符
            currentLanguage = null;
        }

        result += char;

        // 检查下一个字符是否切换了语言，如果切换了，插入一个新的语言标记
        // 注意因为中文和数字属于同一判定，这里中文的判断还要并上一个数字的判断
        var nextChar = text[i + 1];
        if ((currentLanguage === "ZH" && ( !chinesePattern.test(nextChar) && !numberPattern.test(nextChar) )) || 
            (currentLanguage === "JA" && !japanesePattern.test(nextChar))) {
            result += "[" + currentLanguage + "]";
            currentLanguage = null;
        }
    }

    // 处理末尾的情况
    if (currentLanguage === "ZH") {
        result += "[ZH]";
    } else if (currentLanguage === "JA") {
        result += "[JA]";
    }

    return result;
}

// 根据字典替换文本
function replaceWithdict(str) {
    // 读取字典文件
    const dict = JSON.parse(fs.readFileSync('./dict.json', 'utf8'));

    // 检查字典是否为空
    if (!dict || Object.keys(dict).length === 0) {
        return str; // 如果字典为空，则直接返回原始字符串
    }

    // 根据字典中的条目进行替换
    let replaced = str;
    const keys = Object.keys(dict);

    // 根据键的长度倒序排序以确保更长的键先被替换
    keys.sort((a, b) => b.length - a.length);

    // 创建正则表达式模式，考虑大小写敏感性
    const replacePatterns = keys.map(key => {
        const entry = dict[key];
        const pattern = new RegExp(entry.caseSensitive ? key : key.toLowerCase(), 'gi');
        return { pattern, value: entry.value };
    });

    // 逐一替换
    replacePatterns.forEach(({ pattern, value }) => {
        replaced = replaced.replace(pattern, value);
    });

    return replaced;
}