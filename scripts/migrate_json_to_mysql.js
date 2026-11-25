/**
 * SFi Database Migration & Seeder Script
 * Migrates full 695 articles from geo_dataset_hierarchical.json into MySQL (semantic_flood_db)
 */

import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const JSON_DATASET_PATH = path.resolve('../Semantic-Flood-Inventory/data/processed/geocoder/geo_dataset_hierarchical.json');
const SCHEMA_PATH = path.resolve('./database/schema.sql');

// Fine-grained Evacuation Keywords
const EVAC_KEYWORDS_TH = ['ศูนย์พักพิง', 'ศูนย์ช่วยเหลือ', 'จุดพักพิง', 'ที่พักชั่วคราว', 'ศูนย์อพยพ', 'จุดอพยพ', 'อพยพไป', 'อพยพมา', 'หนีน้ำ'];
const EVAC_GENERAL_TH = ['อพยพ'];
const FLOOD_KEYWORDS_TH = ['น้ำท่วม', 'ท่วมขัง', 'เอ่อล้น', 'ระดับน้ำสูง', 'ไหลหลาก', 'จมน้ำ', 'ท่วมพื้นที่', 'พนังกั้นน้ำพัง', 'จม'];

const EVAC_KEYWORDS_EN = ['shelter', 'relief center', 'evacuation center', 'safe zone', 'fled to', 'evacuated to', 'relocated to', 'temporary refuge'];
const FLOOD_KEYWORDS_EN = ['flood', 'inundat', 'submerg', 'overflow', 'flash flood', 'water level', 'levee breach'];

const FOREIGN_ARTICLES = new Set([3, 4, 37, 158, 196, 300, 322, 672, 674, 678, 680, 692]);

const EXPANDED_FOREIGN_PROBE_CITIES = [
  'guangzhou', 'yangtze', 'chengdu', 'wuhan', 'kunming', 'beijing', 'shanghai',
  'xiamen', 'xinjiang', 'xinjianga', 'guangdong', 'sichuan', 'zhejiang', 'hunan',
  'shenzhen', 'wenzhou', 'yantai', 'jiaxing', 'macao', 'macau', 'liao hill',
  'gansu', 'guangxi', 'jining', 'jiangsu', 'shandong', 'hangzhou', 'fujian',
  'taizhou', 'chongqing', 'tianjin', 'hubei', 'jiangxi', 'shaanxi', 'yunnan',
  'guizhou', 'hainan', 'liaoning', 'jilin', 'heilongjiang', 'qinghai', 'ningxia',
  'tibet', 'tibeta', 'yellow sea', 'east china sea', 'south china sea', 'hong kong',
  'taiwan', 'sinhala', 'sinhalese', 'stul', 'patlung', 'jhunjhunu', 'ganges', 'chennai', 'chenai',
  'praia', 'shillong', 'selangor', 'peradeniya', 'peradeya', 'peshmerga', 'danang', 'da nang',
  'nagorno', 'karabakh', 'arequipa', 'ariquipa', 'la rioja', 'netherlands', 'rotterdam',
  'perak', 'kathmandu', 'djibouti', 'maharashtra', 'bangalore', 'jharkhand', 'sikkim',
  'siksika', 'sinanxing', 'sirkima', 'shanxi', 'sinjal', 'gwangju', 'srinagar',
  'guantanamo', 'gangneung', 'sindh', 'kashmir', 'punjab', 'kerala', 'lanka', 'sri lanka',
  'colombo', 'manila', 'hanoi', 'jakarta', 'kuala lumpur', 'singapore', 'vientiane',
  'phnom penh', 'yangon', 'mandalay', 'naypyidaw', 'calcutta', 'kolkata', 'mumbai',
  'delhi', 'new delhi', 'tokyo', 'seoul', 'london', 'paris', 'berlin', 'madrid', 'rome', 'cairo',
  'dubai', 'riyadh', 'amman', 'tahrir', 'houston', 'louisiana', 'texas', 'brazil',
  'porto alegre', 'bento goncalves', 'rio grande do sul', 'sulawesi', 'sumatra',
  'indonesia', 'vietnam', 'malaysia', 'australia'
];

function isValidCoordinate(node, aid) {
  const lat = node.lat;
  const lng = node.lng;
  const geolvl = String(node.geocode_level || '').toUpperCase();
  const geosrc = String(node.geocode_source || '').toUpperCase();
  const name_en = String(node.text_en || '').trim().toLowerCase();
  const addr = String(node.formatted_address || '').toLowerCase();

  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return { valid: false, reason: 'NULL_COORDINATES' };
  }
  if (['FAILED', 'REJECTED_OUT_OF_BOUNDS', 'UNRESOLVED', 'REJECTED'].includes(geolvl)) {
    return { valid: false, reason: `INVALID_GEOCODE_LEVEL_${geolvl}` };
  }
  if (!geosrc || geosrc === 'NONE') {
    return { valid: false, reason: 'NO_GEOCODE_SOURCE' };
  }

  const flat = parseFloat(lat);
  const flng = parseFloat(lng);
  if (isNaN(flat) || isNaN(flng)) {
    return { valid: false, reason: 'INVALID_COORDINATE_FORMAT' };
  }

  const is_foreign_art = FOREIGN_ARTICLES.has(aid) || node.is_foreign;
  if (!is_foreign_art) {
    if (flat < 5.61 || flat > 20.46 || flng < 97.34 || flng > 105.64) {
      return { valid: false, reason: 'OUT_OF_BOUNDS_THAILAND' };
    }
  }

  for (const city of EXPANDED_FOREIGN_PROBE_CITIES) {
    const re = new RegExp(`\\b${city}\\b`, 'i');
    if (re.test(name_en)) {
      const is_shanghai_mansion = city === 'shanghai' && addr.includes('shanghai mansion');
      const is_hong_kong_sakaeo = city === 'hong kong' && (addr.includes('สระแก้ว') || addr.includes('อรัญประเทศ'));
      if (!is_shanghai_mansion && !is_hong_kong_sakaeo) {
        return { valid: false, reason: 'FOREIGN_TOPONYM_REJECTED' };
      }
    }
  }

  return { valid: true, reason: null };
}

function classifyImpact(text) {
  const lower = (text || '').toLowerCase();
  const numMatch = lower.match(/[\d,.]+/);
  let val = null;
  if (numMatch) {
    val = parseFloat(numMatch[0].replace(/,/g, ''));
    if (isNaN(val)) val = null;
  }

  let type = 'GeneralImpact';
  let unit = null;

  if (['person', 'people', 'resident', 'villager', 'victim', 'dead', 'death', 'body', 'bodies', 'injured', 'household', 'family', 'families'].some(w => lower.includes(w))) {
    type = 'HumanImpact';
    if (lower.includes('household') || lower.includes('families') || lower.includes('family')) unit = 'households';
    else unit = 'persons';
  } else if (['house', 'home', 'building', 'bridge', 'road', 'village', 'hectare', 'rai', 'acre', 'school', 'temple'].some(w => lower.includes(w))) {
    type = 'StructuralImpact';
    if (lower.includes('rai')) unit = 'rai';
    else if (lower.includes('house') || lower.includes('home')) unit = 'houses';
    else unit = 'units';
  } else if (['meter', 'centimeter', 'cm', 'm', 'inch', 'millimeter', 'mm', 'knot', 'cubic'].some(w => lower.includes(w))) {
    type = 'HydrologicalMetric';
    if (lower.includes('cm') || lower.includes('centimeter')) unit = 'cm';
    else if (lower.includes('mm') || lower.includes('millimeter')) unit = 'mm';
    else if (lower.includes('m') || lower.includes('meter')) unit = 'm';
    else unit = 'metric';
  }

  return { type, val, unit };
}

function getSemanticRole(node, sentences_th, sentences_en) {
  const name_th = node.text_th || '';
  const name_en = node.text_en || '';
  let has_evac = false;
  let has_flood = false;

  if (name_th && sentences_th) {
    for (const s of sentences_th) {
      if (s.includes(name_th)) {
        if (EVAC_KEYWORDS_TH.some(kw => s.includes(kw))) {
          has_evac = true;
        } else if (EVAC_GENERAL_TH.some(kw => s.includes(kw))) {
          const pos_loc = s.indexOf(name_th);
          const pos_evac = s.indexOf('อพยพ');
          if (Math.abs(pos_loc - pos_evac) <= 40) has_evac = true;
        }
        if (FLOOD_KEYWORDS_TH.some(kw => s.includes(kw))) {
          has_flood = true;
        }
      }
    }
  }

  if (!(has_evac && has_flood) && name_en && sentences_en) {
    for (const para of sentences_en) {
      const fine_sents = para.split(/\.\s+/);
      for (const s of fine_sents) {
        const reLoc = new RegExp(`\\b${name_en}\\b`, 'i');
        if (reLoc.test(s)) {
          if (EVAC_KEYWORDS_EN.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(s))) {
            has_evac = true;
          }
          if (FLOOD_KEYWORDS_EN.some(kw => new RegExp(`\\b${kw}\\b`, 'i').test(s))) {
            has_flood = true;
          }
        }
      }
    }
  }

  if (has_evac) return 'EVACUATION';
  return 'FLOOD';
}

async function runMigration() {
  console.log('================================================================');
  console.log('🚀 SFi JSON to MySQL Full-Scale Migration (695 Articles)');
  console.log('================================================================\n');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true
  });

  try {
    // 1. Initialize Database & Schema
    console.log('1. Initializing schema in MySQL...');
    const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    await connection.query(schemaSql);
    await connection.changeUser({ database: process.env.DB_NAME || 'semantic_flood_db' });
    console.log('   ✅ Schema initialized successfully.\n');

    // 2. Insert Default Superadmin User
    console.log('2. Seeding default superadmin user...');
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('admin123', salt);
    await connection.query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ('admin', 'admin@semanticflood.org', ?, 'SUPERADMIN')
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
    `, [passwordHash]);
    console.log('   ✅ Superadmin user ready: admin@semanticflood.org / admin123\n');

    // 3. Load JSON Dataset
    console.log(`3. Loading dataset from ${JSON_DATASET_PATH}...`);
    const rawData = fs.readFileSync(JSON_DATASET_PATH, 'utf-8');
    const articles = JSON.parse(rawData);
    console.log(`   ✅ Loaded ${articles.length} articles from JSON.\n`);

    // 4. Batch Insertion
    console.log('4. Migrating articles, locations, impacts, and times to MySQL...');
    let totalLocations = 0;
    let totalApprovedLocations = 0;
    let totalRejectedLocations = 0;
    let totalEvacuationLocations = 0;
    let totalImpacts = 0;
    let totalTimes = 0;

    for (let i = 0; i < articles.length; i++) {
      const art = articles[i];
      const aid = art.id;

      const isForeign = FOREIGN_ARTICLES.has(aid);

      // Insert Article
      const [artRes] = await connection.query(`
        INSERT INTO articles (
          article_external_id, title, title_th, title_en, url, source, publish_date,
          content_raw, content_th, content_en, content_summary_en, status, is_foreign, track_stats
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED_TO_KG', ?, ?)
        ON DUPLICATE KEY UPDATE
          title = VALUES(title),
          status = VALUES(status)
      `, [
        aid,
        art.title || art.title_en || `Article #${aid}`,
        art.title_th || null,
        art.title_en || null,
        art.url || null,
        art.source || null,
        art.date || null,
        art.content || null,
        art.content_th || null,
        art.content_en || null,
        art.description_en || null,
        isForeign,
        art.track_stats ? JSON.stringify(art.track_stats) : null
      ]);

      const articleDbId = artRes.insertId || aid;

      // Clean existing related rows if re-running
      await connection.query('DELETE FROM article_locations WHERE article_id = ?', [articleDbId]);
      await connection.query('DELETE FROM article_impacts WHERE article_id = ?', [articleDbId]);
      await connection.query('DELETE FROM article_times WHERE article_id = ?', [articleDbId]);

      // Insert Locations
      const fusedNodes = art.location_fused_nodes || [];
      for (const node of fusedNodes) {
        totalLocations++;
        const { valid, reason } = isValidCoordinate(node, aid);
        const validationStatus = valid ? 'APPROVED' : 'REJECTED';
        if (valid) totalApprovedLocations++;
        else totalRejectedLocations++;

        const semanticRole = getSemanticRole(node, art.sentences, art.sentences_en);
        if (valid && semanticRole === 'EVACUATION') totalEvacuationLocations++;

        const nodeId = node.node_id || (node.text_en || node.text_th || 'loc').toLowerCase().replace(/\W+/g, '_');

        await connection.query(`
          INSERT INTO article_locations (
            article_id, node_id, text_th, text_en, admin_level, category,
            lat, lng, formatted_address, geocode_level, geocode_source, geocode_confidence,
            semantic_role, parent_path, validation_status, rejection_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          articleDbId,
          nodeId,
          node.text_th || null,
          node.text_en || null,
          node.admin_level || null,
          node.category || null,
          node.lat ? parseFloat(node.lat) : null,
          node.lng ? parseFloat(node.lng) : null,
          node.formatted_address || null,
          node.geocode_level || null,
          node.geocode_source || null,
          node.geocode_confidence ? parseFloat(node.geocode_confidence) : null,
          semanticRole,
          node.parent_path ? JSON.stringify(node.parent_path) : null,
          validationStatus,
          reason
        ]);
      }

      // Insert Impacts
      const quantities = art.ner_entities?.QUANTITY || [];
      for (const q of quantities) {
        totalImpacts++;
        const rawExpr = q.word || '';
        const { type, val, unit } = classifyImpact(rawExpr);

        await connection.query(`
          INSERT INTO article_impacts (
            article_id, impact_type, raw_expression, quantity_value, unit, validation_status
          ) VALUES (?, ?, ?, ?, ?, 'APPROVED')
        `, [
          articleDbId,
          type,
          rawExpr,
          val,
          unit
        ]);
      }

      // Insert Times
      const times = art.ner_entities?.TIME || [];
      for (const t of times) {
        totalTimes++;
        await connection.query(`
          INSERT INTO article_times (
            article_id, time_expression, calendar_system
          ) VALUES (?, ?, ?)
        `, [
          articleDbId,
          t.word || '',
          t.calendar || null
        ]);
      }

      if ((i + 1) % 100 === 0 || i === articles.length - 1) {
        console.log(`   ⏳ Processed ${i + 1} / ${articles.length} articles...`);
      }
    }

    // 5. Insert Sync Log
    console.log('\n5. Logging initial bulk sync audit log...');
    await connection.query(`
      INSERT INTO sync_logs (article_id, action, triples_count, status, message, performed_by)
      VALUES (NULL, 'BULK_IMPORT', 60199, 'SUCCESS', 'Initial migration of 695 articles from JSON dataset to MySQL', 1)
    `);

    console.log('\n================================================================');
    console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('================================================================');
    console.log(`📊 Summary of Migrated Entities:`);
    console.log(`   • Total Articles Migrated   : ${articles.length}`);
    console.log(`   • Total Extracted Locations : ${totalLocations.toLocaleString()} rows`);
    console.log(`     - Approved Locations      : ${totalApprovedLocations.toLocaleString()} (${((totalApprovedLocations/totalLocations)*100).toFixed(2)}%)`);
    console.log(`     - Rejected Locations (Log): ${totalRejectedLocations.toLocaleString()} (${((totalRejectedLocations/totalLocations)*100).toFixed(2)}%)`);
    console.log(`     - Evacuation Shelters     : ${totalEvacuationLocations.toLocaleString()} locations`);
    console.log(`   • Total Quantitative Impacts: ${totalImpacts.toLocaleString()} rows`);
    console.log(`   • Total Temporal Mentions   : ${totalTimes.toLocaleString()} rows`);
    console.log('================================================================\n');

  } catch (error) {
    console.error('❌ Migration Failed:', error);
  } finally {
    await connection.end();
  }
}

runMigration();
