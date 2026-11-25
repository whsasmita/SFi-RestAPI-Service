import fs from 'fs';
import path from 'path';
import pool from '../src/config/db.js';

async function verifyDatasetSync() {
  const datasetPath = path.resolve('../Semantic-Flood-Inventory/dataset_cheerio-scraper_2026-07-08_10-42-18-231.json');
  const data = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  console.log(`✓ Read ${data.length} items from Apify scraped dataset.`);

  const sample = data[0];
  console.log(`\nSample Thai Title: ${sample.judul}`);
  console.log(`Sample URL: ${sample.url}`);
  console.log(`Sample Source: ${sample.sumber}`);

  // Test deduplication and insertion
  const [existing] = await pool.query('SELECT id, title, status FROM articles WHERE url = ?', [sample.url]);
  if (existing.length > 0) {
    console.log(`✓ Found existing article #${existing[0].id} in MySQL with status '${existing[0].status}'. URL deduplication is active.`);
  } else {
    const [res] = await pool.query(
      `INSERT INTO articles (title, title_th, url, source, publish_date, content_raw, status)
       VALUES (?, ?, ?, ?, ?, ?, 'SCRAPED')`,
      [sample.judul, sample.judul, sample.url, sample.sumber, sample.tanggal, sample.konten]
    );
    console.log(`✓ Inserted new article #${res.insertId} with status 'SCRAPED'.`);
  }

  const [totalCount] = await pool.query('SELECT COUNT(*) as total, status FROM articles GROUP BY status');
  console.log('\nCurrent MySQL Article Status Counts:');
  console.table(totalCount);

  process.exit(0);
}

verifyDatasetSync().catch((err) => {
  console.error('Error during dataset sync verification:', err);
  process.exit(1);
});
