
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./gallery.db');

const fields = [
  { name: 'tags', type: 'TEXT' },
  { name: 'lens', type: 'TEXT' },
  { name: 'focal_length', type: 'TEXT' },
  { name: 'camera_settings', type: 'TEXT' },
  { name: 'date_taken', type: 'TEXT' },
  { name: 'category', type: 'TEXT' }
];

fields.forEach(field => {
  db.run(
    `ALTER TABLE photos ADD COLUMN ${field.name} ${field.type}`,
    err => {
      if (err && !err.message.includes('duplicate column')) {
        console.error(`Failed to add column ${field.name}:`, err.message);
      } else {
        console.log(`Column ${field.name} added or already exists.`);
      }
    }
  );
});

db.close();
