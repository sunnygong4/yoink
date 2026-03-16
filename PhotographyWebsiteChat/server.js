const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const db = new sqlite3.Database('./gallery.db');

// 静态资源路径设置
app.use(express.static(path.join(__dirname)));
app.use('/images', express.static(path.join(__dirname, 'gallery-images')));

// 读取实际存在的图片文件名（用于过滤数据库中无效条目）
const imageDir = path.join(__dirname, 'gallery-images');
let existingFiles = new Set();
try {
  existingFiles = new Set(fs.readdirSync(imageDir));
} catch (err) {
  console.error("❌ Failed to read gallery-images folder:", err.message);
}

// API 接口返回去重且存在于文件夹的图片列表
app.get('/api/gallery', (req, res) => {
  db.all('SELECT * FROM photos', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // 过滤掉重复和不存在的文件
    const seen = new Set();
    const filtered = rows.filter(photo => {
      if (!existingFiles.has(photo.filename)) return false;
      if (seen.has(photo.filename)) return false;
      seen.add(photo.filename);
      return true;
    });

    res.json(filtered);
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
