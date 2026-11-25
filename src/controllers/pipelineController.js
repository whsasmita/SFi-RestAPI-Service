import axios from 'axios';
import pool from '../config/db.js';

const GRAPHDB_URL = process.env.GRAPHDB_BASE_URL || 'http://localhost:7200';
const GRAPHDB_REPO = process.env.GRAPHDB_REPOSITORY || 'flood-events-db';

function escapeTurtleLiteral(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function getLocationOwlClass(adminLevel) {
  const lvl = Number(adminLevel);
  if (lvl === 1) return 'flood:Province';
  if (lvl === 2) return 'flood:District';
  if (lvl === 3) return 'flood:Subdistrict';
  if (lvl === 4) return 'flood:Village';
  if (lvl === 5) return 'flood:HydroBody';
  return 'flood:GeneralLocation';
}

function sanitizeNodeId(raw) {
  if (!raw) return 'loc_unknown';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Step 1 of Atomic Upsert:
 * Remove stale triples tied specifically to res:event_{articleId}, its impacts, its times,
 * and mutable literal properties of its locations, while preserving shared location URIs.
 */
async function preDeleteEventTriples(articleId, locationNodeIds = []) {
  const statementsUrl = `${GRAPHDB_URL}/repositories/${GRAPHDB_REPO}/statements`;

  const locDeleteClauses = locationNodeIds
    .map((nid) => {
      const cleanId = sanitizeNodeId(nid).replace(/^loc_/, '');
      const locUri = `res:loc_${cleanId}`;
      return `
        DELETE {
          ${locUri} ?locPred ?locVal .
        }
        WHERE {
          ${locUri} ?locPred ?locVal .
          FILTER(?locPred IN (
            rdfs:label, flood:nameEn, flood:nameTh, flood:adminLevel, flood:category,
            geo:lat, geo:long, flood:formattedAddress, flood:geocodeConfidence,
            flood:geocodeLevel, flood:status
          ))
        };
      `;
    })
    .join('\n');

  const sparqlUpdate = `
    PREFIX flood: <http://example.org/ontology/flood#>
    PREFIX res: <http://example.org/resource/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>

    DELETE WHERE { ?imp flood:isImpactOf res:event_${articleId} ; ?p ?o . };
    DELETE WHERE { ?tm flood:isDateOfFlood res:event_${articleId} ; ?p ?o . };
    DELETE WHERE { res:event_${articleId} ?p ?o . };
    DELETE WHERE { ?s ?p res:event_${articleId} . };
    ${locDeleteClauses}
  `;

  await axios.post(statementsUrl, sparqlUpdate, {
    headers: {
      'Content-Type': 'application/sparql-update'
    }
  });
}

/**
 * Build full Ontology-compliant RDF Turtle triples for a single article
 * (matching Semantic-Flood-Inventory/src/ontology/build_rdf_graph.py)
 */
function buildArticleTurtle(article, locations, impacts, times) {
  const lines = [
    '@prefix flood: <http://example.org/ontology/flood#> .',
    '@prefix res: <http://example.org/resource/> .',
    '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
    '@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .',
    '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .'
  ];

  const aid = article.article_external_id || article.id;
  const eventUri = `res:event_${article.id}`;
  const eventTitle = article.title_en || article.title || `Article #${article.id}`;

  // 1. FloodEvent Triples
  lines.push(`${eventUri} a flood:FloodEvent ;`);
  lines.push(`    rdfs:label "Event #${article.id}: ${escapeTurtleLiteral(eventTitle)}" ;`);
  lines.push(`    flood:articleId "${article.id}"^^xsd:integer ;`);
  if (article.title) lines.push(`    flood:title "${escapeTurtleLiteral(article.title)}"^^xsd:string ;`);
  if (article.title_en) lines.push(`    flood:titleEn "${escapeTurtleLiteral(article.title_en)}"^^xsd:string ;`);
  if (article.title_th) lines.push(`    flood:titleTh "${escapeTurtleLiteral(article.title_th)}"^^xsd:string ;`);
  if (article.publish_date) lines.push(`    flood:publishDate "${escapeTurtleLiteral(article.publish_date)}"^^xsd:string ;`);
  if (article.source) lines.push(`    flood:source "${escapeTurtleLiteral(article.source)}"^^xsd:string ;`);
  if (article.content_summary_en || article.content_en) {
    const summary = article.content_summary_en || String(article.content_en).substring(0, 350);
    lines.push(`    flood:contentSummary "${escapeTurtleLiteral(summary)}"^^xsd:string ;`);
  }
  if (article.url) lines.push(`    flood:url "${escapeTurtleLiteral(article.url)}"^^xsd:anyURI ;`);
  lines.push('    flood:status "PUBLISHED" .');

  // Map location names in this article to their node_id for parent hierarchy resolution
  const localNameMap = new Map();
  for (const loc of locations) {
    const cleanNid = sanitizeNodeId(loc.node_id || loc.text_en || loc.text_th || `loc_${loc.id}`).replace(/^loc_/, '');
    if (loc.text_en) {
      localNameMap.set(loc.text_en.trim().toLowerCase(), cleanNid);
      const baseEn = loc.text_en.replace(/\s+(?:Province|District|Subdistrict|Village)$/i, '').trim().toLowerCase();
      if (baseEn) localNameMap.set(baseEn, cleanNid);
    }
    if (loc.text_th) {
      localNameMap.set(loc.text_th.trim().toLowerCase(), cleanNid);
    }
  }

  // 2. Locations & Hierarchical Containment Links
  for (const loc of locations) {
    const cleanNid = sanitizeNodeId(loc.node_id || loc.text_en || loc.text_th || `loc_${loc.id}`).replace(/^loc_/, '');
    const locUri = `res:loc_${cleanNid}`;
    const locLabel = loc.text_en || loc.text_th || cleanNid;
    const owlClass = getLocationOwlClass(loc.admin_level);

    lines.push(`${locUri} a ${owlClass} ;`);
    lines.push(`    flood:nodeId "${escapeTurtleLiteral(cleanNid)}"^^xsd:string ;`);
    lines.push(`    rdfs:label "${escapeTurtleLiteral(locLabel)}" ;`);
    if (loc.text_en) lines.push(`    flood:nameEn "${escapeTurtleLiteral(loc.text_en)}"^^xsd:string ;`);
    if (loc.text_th) lines.push(`    flood:nameTh "${escapeTurtleLiteral(loc.text_th)}"^^xsd:string ;`);
    if (loc.admin_level) lines.push(`    flood:adminLevel "${ parseInt(loc.admin_level, 10) }"^^xsd:integer ;`);
    if (loc.category) lines.push(`    flood:category "${escapeTurtleLiteral(loc.category)}"^^xsd:string ;`);
    if (loc.lat !== null && loc.lat !== undefined && loc.lng !== null && loc.lng !== undefined) {
      lines.push(`    geo:lat "${parseFloat(loc.lat)}"^^xsd:double ;`);
      lines.push(`    geo:long "${parseFloat(loc.lng)}"^^xsd:double ;`);
    }
    if (loc.formatted_address) {
      lines.push(`    flood:formattedAddress "${escapeTurtleLiteral(loc.formatted_address)}"^^xsd:string ;`);
    }
    if (loc.geocode_confidence !== null && loc.geocode_confidence !== undefined) {
      lines.push(`    flood:geocodeConfidence "${parseFloat(loc.geocode_confidence)}"^^xsd:double ;`);
    }
    if (loc.geocode_level) {
      lines.push(`    flood:geocodeLevel "${escapeTurtleLiteral(loc.geocode_level)}"^^xsd:string ;`);
    }
    lines.push('    flood:status "ACTIVE" .');

    // Hierarchical Parent Linking (hasParentLocation / hasSubLocation)
    let parentPath = [];
    if (Array.isArray(loc.parent_path)) {
      parentPath = loc.parent_path;
    } else if (typeof loc.parent_path === 'string' && loc.parent_path.trim()) {
      try {
        parentPath = JSON.parse(loc.parent_path);
      } catch {
        parentPath = [];
      }
    }

    if (Array.isArray(parentPath) && parentPath.length > 0) {
      for (let pIdx = 0; pIdx < parentPath.length; pIdx++) {
        const parentName = String(parentPath[pIdx] || '').trim();
        if (!parentName) continue;

        const baseParent = parentName.replace(/\s+(?:Province|District|Subdistrict|Village)$/i, '').trim().toLowerCase();
        const resolvedParentNid =
          localNameMap.get(parentName.toLowerCase()) ||
          localNameMap.get(baseParent) ||
          sanitizeNodeId(parentName);

        const parentUri = `res:loc_${resolvedParentNid}`;
        if (parentUri !== locUri) {
          lines.push(`${locUri} flood:hasParentLocation ${parentUri} .`);
          lines.push(`${parentUri} flood:hasSubLocation ${locUri} .`);

          // If parent is a Province (index 0 or ends with Province), ensure its Province class & label exist
          if (pIdx === 0 || /province$/i.test(parentName)) {
            lines.push(`${parentUri} a flood:Province ;`);
            lines.push(`    rdfs:label "${escapeTurtleLiteral(parentName)}" ;`);
            lines.push(`    flood:nameEn "${escapeTurtleLiteral(parentName)}"^^xsd:string ;`);
            lines.push(`    flood:adminLevel "1"^^xsd:integer .`);
          }
        }
      }
    }

    // Event <-> Location Bidirectional Semantic Role Linking
    if (loc.semantic_role === 'EVACUATION') {
      lines.push(`${eventUri} flood:hasLocation_Evacuation ${locUri} .`);
      lines.push(`${locUri} flood:isEvacuationLocationOf ${eventUri} .`);
    } else if (loc.semantic_role === 'FLOOD') {
      lines.push(`${eventUri} flood:hasLocation_Flood ${locUri} .`);
      lines.push(`${locUri} flood:isFloodLocationOf ${eventUri} .`);
    } else {
      lines.push(`${eventUri} flood:hasLocation_General ${locUri} .`);
      lines.push(`${locUri} flood:isGeneralLocationOf ${eventUri} .`);
    }
  }

  // 3. Impact Entities (Bidirectional)
  for (let i = 0; i < impacts.length; i++) {
    const imp = impacts[i];
    const impUri = `res:impact_${article.id}_${i + 1}`;
    const impType = ['HumanImpact', 'StructuralImpact', 'HydrologicalMetric', 'EconomicImpact'].includes(imp.impact_type)
      ? imp.impact_type
      : 'ImpactEntity';
    const rawExpr = imp.raw_expression || `${imp.quantity_value || ''} ${imp.unit || ''}`.trim();
    const impLabel = `${imp.impact_type || 'Impact'}: ${rawExpr}`;

    const props = [
      `a flood:${impType}`,
      `rdfs:label "${escapeTurtleLiteral(impLabel)}"`,
      `flood:rawImpactExpression "${escapeTurtleLiteral(rawExpr)}"^^xsd:string`,
      `flood:impactType "${escapeTurtleLiteral(imp.impact_type || 'GeneralImpact')}"^^xsd:string`
    ];
    if (imp.quantity_value !== null && imp.quantity_value !== undefined && !isNaN(parseFloat(imp.quantity_value))) {
      props.push(`flood:quantityValue "${parseFloat(imp.quantity_value)}"^^xsd:decimal`);
    }
    if (imp.unit) {
      props.push(`flood:unit "${escapeTurtleLiteral(imp.unit)}"^^xsd:string`);
    }

    lines.push(`${impUri} ` + props.join(' ;\n    ') + ' .');
    lines.push(`${impUri} flood:isImpactOf ${eventUri} .`);
    lines.push(`${eventUri} flood:hasImpact ${impUri} .`);
  }

  // 4. Time Entities (Bidirectional)
  for (let tIdx = 0; tIdx < times.length; tIdx++) {
    const tm = times[tIdx];
    const timeUri = `res:time_${article.id}_${tIdx + 1}`;
    const timeExpr = tm.time_expression || '';
    const calSystem = tm.calendar_system || 'CommonEra';

    const props = [
      'a flood:TimeEntity',
      `rdfs:label "Time: ${escapeTurtleLiteral(timeExpr)}"`,
      `flood:timeExpression "${escapeTurtleLiteral(timeExpr)}"^^xsd:string`,
      `flood:calendarSystem "${escapeTurtleLiteral(calSystem)}"^^xsd:string`
    ];
    if (tm.normalized_date) {
      props.push(`flood:normalizedDate "${escapeTurtleLiteral(tm.normalized_date)}"^^xsd:date`);
    }

    lines.push(`${timeUri} ` + props.join(' ;\n    ') + ' .');
    lines.push(`${timeUri} flood:isDateOfFlood ${eventUri} .`);
    lines.push(`${eventUri} flood:occursOnDate ${timeUri} .`);
  }

  return {
    turtleData: lines.join('\n'),
    triplesCount: lines.length,
    aid
  };
}

/**
 * Helper to publish a single article with Atomic SPARQL Upsert
 */
async function executeSingleArticlePublish(articleId, userId = null, logSync = true) {
  const [articles] = await pool.query('SELECT * FROM articles WHERE id = ?', [articleId]);
  if (articles.length === 0) {
    throw new Error(`Article #${articleId} not found`);
  }

  const article = articles[0];
  const [locations] = await pool.query(
    `SELECT * FROM article_locations 
     WHERE article_id = ? 
       AND validation_status IN ('APPROVED', 'MODIFIED')
       AND lat IS NOT NULL AND lng IS NOT NULL`,
    [articleId]
  );

  // Fallback: if operator hasn't clicked individual approve yet, take non-rejected with valid coordinates
  let validLocations = locations;
  if (validLocations.length === 0) {
    const [fallbackLocs] = await pool.query(
      `SELECT * FROM article_locations 
       WHERE article_id = ? 
         AND validation_status != 'REJECTED'
         AND lat IS NOT NULL AND lng IS NOT NULL`,
      [articleId]
    );
    validLocations = fallbackLocs;
  }

  const [impacts] = await pool.query(
    'SELECT * FROM article_impacts WHERE article_id = ? AND validation_status != "REJECTED"',
    [articleId]
  );
  const [times] = await pool.query('SELECT * FROM article_times WHERE article_id = ?', [articleId]);

  // Completeness Quality Gate: Article must have >=1 valid LOC, >=1 TIME (or publish date), and >=1 IMPACT
  const hasValidLoc = validLocations.length >= 1;
  const hasValidTime = times.length >= 1 || Boolean(article.publish_date);
  const hasValidImpact = impacts.length >= 1;

  if (!hasValidLoc || !hasValidTime || !hasValidImpact) {
    await pool.query('UPDATE articles SET status = "INCOMPLETE_ENTITIES" WHERE id = ?', [articleId]);
    const missing = [];
    if (!hasValidLoc) missing.push('LOC (no valid coordinates in Thailand bounds)');
    if (!hasValidTime) missing.push('TIME (no temporal expression or publication date)');
    if (!hasValidImpact) missing.push('IMPACT (no quantitative disaster impact detected)');
    
    if (logSync) {
      await pool.query(
        'INSERT INTO sync_logs (article_id, action, triples_count, status, message, performed_by) VALUES (?, "QUALITY_GATE_REJECT", 0, "HELD_BACK", ?, ?)',
        [articleId, `Held back by Completeness Quality Gate: missing ${missing.join(', ')}`, userId]
      );
    }
    throw new Error(`Article #${articleId} fails Completeness Quality Gate. Missing: ${missing.join(', ')}`);
  }

  // Step 1: Atomic Pre-Delete in GraphDB to prevent duplicate/conflicting triples
  const nodeIds = validLocations.map((l) => l.node_id || `loc_${l.id}`);
  await preDeleteEventTriples(article.id, nodeIds);

  // Step 2: Generate Ontology-Compliant Turtle & POST to GraphDB
  const { turtleData, triplesCount } = buildArticleTurtle(article, validLocations, impacts, times);
  const graphDbStatementsUrl = `${GRAPHDB_URL}/repositories/${GRAPHDB_REPO}/statements`;

  await axios.post(graphDbStatementsUrl, turtleData, {
    headers: {
      'Content-Type': 'text/turtle'
    }
  });

  // Step 3: Mark locations as APPROVED and article as PUBLISHED_TO_KG in MySQL
  await pool.query(
    `UPDATE article_locations 
     SET validation_status = 'APPROVED' 
     WHERE article_id = ? AND validation_status = 'PENDING' AND lat IS NOT NULL AND lng IS NOT NULL`,
    [articleId]
  );
  await pool.query('UPDATE articles SET status = "PUBLISHED_TO_KG" WHERE id = ?', [articleId]);

  if (logSync) {
    await pool.query(
      'INSERT INTO sync_logs (article_id, action, triples_count, status, message, performed_by) VALUES (?, "PUBLISH_ARTICLE", ?, "SUCCESS", "Published to GraphDB via Atomic Upsert", ?)',
      [articleId, triplesCount, userId]
    );
  }

  return {
    articleId: article.id,
    triplesCount,
    locationsPublished: validLocations.length,
    impactsPublished: impacts.length,
    timesPublished: times.length
  };
}

// Publish single validated article to GraphDB
export const publishArticleToKG = async (req, res) => {
  try {
    const { articleId } = req.params;
    const result = await executeSingleArticlePublish(articleId, req.user?.id || null, true);

    return res.json({
      success: true,
      message: `Article #${articleId} successfully published to Knowledge Graph (GraphDB) via Atomic Upsert`,
      triplesGenerated: result.triplesCount,
      details: result
    });
  } catch (error) {
    console.error('publishArticleToKG error:', error);
    const errorDetail = error.response?.data || error.message;
    return res.status(500).json({
      success: false,
      message: `Failed to publish to GraphDB: ${errorDetail}`,
      error: errorDetail
    });
  }
};

// Bulk Publish All Validated Articles to GraphDB
export const publishBatchValidatedToKG = async (req, res) => {
  try {
    const { articleIds, limit = 100 } = req.body || {};
    let targetIds = [];

    if (Array.isArray(articleIds) && articleIds.length > 0) {
      targetIds = articleIds.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
    } else {
      // Find all articles with status = 'VALIDATED' (or having APPROVED locations and not yet PUBLISHED_TO_KG)
      const [rows] = await pool.query(
        `SELECT DISTINCT a.id 
         FROM articles a
         LEFT JOIN article_locations al ON al.article_id = a.id
         WHERE a.status = 'VALIDATED'
            OR (a.status IN ('SCRAPED', 'PROCESSING') AND al.validation_status = 'APPROVED')
         ORDER BY a.id ASC
         LIMIT ?`,
        [parseInt(limit, 10) || 100]
      );
      targetIds = rows.map((r) => r.id);
    }

    if (targetIds.length === 0) {
      return res.json({
        success: true,
        message: 'No validated articles pending publication to GraphDB.',
        publishedCount: 0,
        totalTriplesGenerated: 0,
        publishedIds: [],
        errors: []
      });
    }

    const publishedIds = [];
    const errors = [];
    let totalTriplesGenerated = 0;

    for (const aid of targetIds) {
      try {
        const resSingle = await executeSingleArticlePublish(aid, req.user?.id || null, false);
        publishedIds.push(aid);
        totalTriplesGenerated += resSingle.triplesCount;
      } catch (err) {
        errors.push({
          article_id: aid,
          error: err.response?.data || err.message
        });
      }
    }

    // Record bulk sync log
    if (publishedIds.length > 0) {
      await pool.query(
        'INSERT INTO sync_logs (article_id, action, triples_count, status, message, performed_by) VALUES (NULL, "BULK_IMPORT", ?, "SUCCESS", ?, ?)',
        [
          totalTriplesGenerated,
          `Bulk published ${publishedIds.length} validated articles to GraphDB`,
          req.user?.id || null
        ]
      );
    }

    return res.json({
      success: true,
      message: `Batch publish completed: ${publishedIds.length} articles pushed to Ontotext GraphDB (${totalTriplesGenerated.toLocaleString()} RDF statements).`,
      publishedCount: publishedIds.length,
      totalTriplesGenerated,
      publishedIds,
      errorsCount: errors.length,
      errors
    });
  } catch (error) {
    console.error('publishBatchValidatedToKG error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to execute batch publish to GraphDB',
      error: error.response?.data || error.message
    });
  }
};

// Check pipeline & GraphDB connection health
export const getPipelineHealth = async (req, res) => {
  try {
    const graphDbSizeUrl = `${GRAPHDB_URL}/repositories/${GRAPHDB_REPO}/size`;
    const response = await axios.get(graphDbSizeUrl);

    const [stats] = await pool.query(`
      SELECT 
        COUNT(*) as total_articles,
        SUM(CASE WHEN status = 'PUBLISHED_TO_KG' THEN 1 ELSE 0 END) as published_count,
        SUM(CASE WHEN status = 'VALIDATED' THEN 1 ELSE 0 END) as ready_count,
        SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) as processing_count,
        SUM(CASE WHEN status = 'SCRAPED' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) as rejected_count
      FROM articles
    `);

    return res.json({
      success: true,
      data: {
        graphdb_status: 'CONNECTED',
        graphdb_triples_count: parseInt(response.data, 10),
        database_statistics: stats[0]
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'GraphDB connection error',
      error: error.message
    });
  }
};
