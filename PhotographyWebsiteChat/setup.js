const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database('./gallery.db');

// Step 1: Recreate photos table
db.serialize(() => {
  db.run(`DROP TABLE IF EXISTS photos`);
  db.run(`
    CREATE TABLE photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      title TEXT
    )
  `);

  const imageDir = path.join(__dirname, 'gallery-images');
  const files = fs.readdirSync(imageDir).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
  });

  const stmt = db.prepare("INSERT INTO photos (filename, title) VALUES (?, ?)");

  files.forEach(file => {
    stmt.run(file, file);
  });

  stmt.finalize(() => {
    console.log(`✅ Inserted ${files.length} images into gallery.db`);
    db.close();
  });
});
