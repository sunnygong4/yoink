const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./gallery.db');

// Helper to check if a column exists
function columnExists(columnName, callback) {
  db.all("PRAGMA table_info(photos);", (err, columns) => {
    if (err) return callback(err);
    const exists = columns.some(col => col.name === columnName);
    callback(null, exists);
  });
}

// List of new columns
const newColumns = [
  { name: 'category', type: 'TEXT' },
  { name: 'tags', type: 'TEXT' },
  { name: 'lens', type: 'TEXT' },
  { name: 'focalLength', type: 'TEXT' },
  { name: 'settings', type: 'TEXT' },
  { name: 'dateTaken', type: 'TEXT' },
];

function extendTable(columns, done) {
  if (columns.length === 0) return done();

  const { name, type } = columns.shift();
  columnExists(name, (err, exists) => {
    if (err) return console.error(err);
    if (!exists) {
      db.run(`ALTER TABLE photos ADD COLUMN ${name} ${type}`, (err) => {
        if (err) return console.error(`❌ Failed to add ${name}:`, err.message);
        console.log(`✅ Added column: ${name}`);
        extendTable(columns, done);
      });
    } else {
      console.log(`⚠️ Column "${name}" already exists, skipping.`);
      extendTable(columns, done);
    }
  });
}

extendTable([...newColumns], () => {
  console.log("✅ Table update check complete.");
  db.close();
});
