import axios from 'axios';
import pool from '../config/db.js';

const APIFY_API_BASE = 'https://api.apify.com/v2';
const FREE_TIER_MONTHLY_LIMIT_USD = 5.00;

/**
 * Get current crawler & Apify configuration
 */
export const getCrawlerConfig = async (req, res) => {
  try {
    const token = process.env.APIFY_TOKEN || '';
    const maskedToken = token.length > 8 ? `${token.substring(0, 10)}...${token.substring(token.length - 4)}` : (token ? 'CONFIGURED' : 'NOT_CONFIGURED');

    return res.json({
      success: true,
      data: {
        is_token_configured: Boolean(token),
        masked_token: maskedToken,
        cheerio_actor_id: process.env.CheerioActorId || 'apify/cheerio-scraper',
        cheerio_task_id: process.env.TaskCheerioId || 'whsasmita/cheerio-scraper-task',
        web_scraper_actor_id: process.env.WScraperActorId || 'apify/web-scraper',
        web_scraper_task_id: process.env.TaskWScraperId || 'whsasmita/web-scraper-task'
      }
    });
  } catch (error) {
    console.error('getCrawlerConfig error:', error);
    return res.status(500).json({ success: false, message: 'Failed to get crawler config', error: error.message });
  }
};

/**
 * Get Apify Account & Task Usage Stats (Quota, Remaining Balance, Recent Runs)
 */
export const getCrawlerUsageStats = async (req, res) => {
  try {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      return res.status(400).json({ success: false, message: 'APIFY_TOKEN is not configured' });
    }

    const taskId = process.env.TaskCheerioId || 'whsasmita/cheerio-scraper-task';

    // Fetch Task Info and recent runs
    const runsUrl = `${APIFY_API_BASE}/actor-tasks/${encodeURIComponent(taskId)}/runs?token=${token}&limit=10`;
    const runsRes = await axios.get(runsUrl);
    const runs = runsRes.data?.data?.items || [];

    let totalRecentUsageUsd = 0;
    runs.forEach((r) => {
      totalRecentUsageUsd += (r.usageTotalUsd || 0);
    });

    const latestRun = runs[0] || null;
    let latestDatasetItems = 0;

    if (latestRun?.defaultDatasetId) {
      try {
        const dsRes = await axios.get(`${APIFY_API_BASE}/datasets/${latestRun.defaultDatasetId}?token=${token}`);
        latestDatasetItems = dsRes.data?.data?.itemCount || 0;
      } catch (e) {
        // Dataset count lookup fallback
      }
    }

    const remainingLimitUsd = Math.max(0, FREE_TIER_MONTHLY_LIMIT_USD - totalRecentUsageUsd);
    const usagePercent = Math.min(100, (totalRecentUsageUsd / FREE_TIER_MONTHLY_LIMIT_USD) * 100);

    return res.json({
      success: true,
      data: {
        connection_status: 'CONNECTED',
        task_id: taskId,
        monthly_limit_usd: FREE_TIER_MONTHLY_LIMIT_USD,
        used_usd: totalRecentUsageUsd,
        remaining_usd: remainingLimitUsd,
        usage_percent: parseFloat(usagePercent.toFixed(2)),
        remaining_percent: parseFloat((100 - usagePercent).toFixed(2)),
        total_recent_runs: runs.length,
        latest_run: latestRun ? {
          id: latestRun.id,
          status: latestRun.status,
          started_at: latestRun.startedAt,
          finished_at: latestRun.finishedAt,
          cost_usd: latestRun.usageTotalUsd || 0,
          dataset_id: latestRun.defaultDatasetId,
          dataset_items_count: latestDatasetItems
        } : null
      }
    });
  } catch (error) {
    console.error('getCrawlerUsageStats error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Apify usage statistics',
      error: error.response?.data?.error?.message || error.message
    });
  }
};

/**
 * Trigger an Apify Actor or Task run
 */
export const triggerCrawlerTask = async (req, res) => {
  try {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'APIFY_TOKEN is not configured in .env'
      });
    }

    const { taskId = process.env.TaskCheerioId || 'whsasmita/cheerio-scraper-task', inputOverrides } = req.body;

    const url = `${APIFY_API_BASE}/actor-tasks/${encodeURIComponent(taskId)}/runs?token=${token}`;
    
    const response = await axios.post(url, inputOverrides || {}, {
      headers: { 'Content-Type': 'application/json' }
    });

    const runData = response.data?.data || {};

    return res.json({
      success: true,
      message: `Apify task '${taskId}' triggered successfully`,
      data: {
        run_id: runData.id,
        actor_id: runData.actId,
        task_id: runData.actorTaskId,
        status: runData.status,
        started_at: runData.startedAt,
        default_dataset_id: runData.defaultDatasetId
      }
    });
  } catch (error) {
    console.error('triggerCrawlerTask error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to trigger Apify scraper task',
      error: error.response?.data?.error?.message || error.message
    });
  }
};

/**
 * Check execution status of an Apify Run (with live item count)
 */
export const getCrawlerRunStatus = async (req, res) => {
  try {
    const token = process.env.APIFY_TOKEN;
    const { runId } = req.params;

    if (!token) {
      return res.status(400).json({ success: false, message: 'APIFY_TOKEN is not configured in .env' });
    }

    const url = `${APIFY_API_BASE}/actor-runs/${runId}?token=${token}`;
    const response = await axios.get(url);
    const runData = response.data?.data || {};

    let itemCount = 0;
    if (runData.defaultDatasetId) {
      try {
        const dsRes = await axios.get(`${APIFY_API_BASE}/datasets/${runData.defaultDatasetId}?token=${token}`);
        itemCount = dsRes.data?.data?.itemCount || 0;
      } catch (e) {
        // dataset metric fallback
      }
    }

    return res.json({
      success: true,
      data: {
        run_id: runData.id,
        status: runData.status,
        started_at: runData.startedAt,
        finished_at: runData.finishedAt,
        dataset_id: runData.defaultDatasetId,
        item_count: itemCount,
        usage_total_usd: runData.usageTotalUsd || 0
      }
    });
  } catch (error) {
    console.error('getCrawlerRunStatus error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to get Apify run status',
      error: error.response?.data?.error?.message || error.message
    });
  }
};

/**
 * Sync / Ingest dataset items from Apify into MySQL articles table (with deduplication)
 */
export const syncDatasetToMySQL = async (req, res) => {
  try {
    const token = process.env.APIFY_TOKEN;
    const { datasetId, taskId, runId, items: directItems } = req.body || {};

    let itemsToIngest = [];
    let resolvedDatasetId = datasetId || null;

    if (Array.isArray(directItems) && directItems.length > 0) {
      itemsToIngest = directItems;
    } else {
      if (!token) {
        return res.status(400).json({ success: false, message: 'APIFY_TOKEN is required in .env' });
      }

      // If specific datasetId is not provided, resolve from runId, taskId, or latest account run
      if (!resolvedDatasetId) {
        if (runId) {
          try {
            const runRes = await axios.get(`${APIFY_API_BASE}/actor-runs/${runId}?token=${token}`);
            resolvedDatasetId = runRes.data?.data?.defaultDatasetId;
          } catch (e) {
            console.warn(`Could not resolve datasetId from runId ${runId}:`, e.message);
          }
        }

        if (!resolvedDatasetId && taskId) {
          try {
            const runsRes = await axios.get(`${APIFY_API_BASE}/actor-tasks/${encodeURIComponent(taskId)}/runs?token=${token}&limit=3&desc=1`);
            const runs = runsRes.data?.data?.items || [];
            const validRun = runs.find(r => r.defaultDatasetId);
            if (validRun) resolvedDatasetId = validRun.defaultDatasetId;
          } catch (e) {
            console.warn(`Could not resolve datasetId from taskId ${taskId}:`, e.message);
          }
        }

        // Universal fallback: find the most recent successful run across the Apify account
        if (!resolvedDatasetId) {
          try {
            const allRunsRes = await axios.get(`${APIFY_API_BASE}/actor-runs?token=${token}&limit=5&desc=1`);
            const allRuns = allRunsRes.data?.data?.items || [];
            const latestSucceeded = allRuns.find(r => r.status === 'SUCCEEDED' && r.defaultDatasetId) || allRuns.find(r => r.defaultDatasetId);
            if (latestSucceeded) resolvedDatasetId = latestSucceeded.defaultDatasetId;
          } catch (e) {
            console.warn('Could not resolve datasetId from recent account runs:', e.message);
          }
        }
      }

      if (!resolvedDatasetId) {
        return res.status(404).json({
          success: false,
          message: 'No Apify dataset or completed crawler run found to sync. Please run the crawler first.'
        });
      }

      const url = `${APIFY_API_BASE}/datasets/${resolvedDatasetId}/items?token=${token}&format=json`;
      const response = await axios.get(url);
      itemsToIngest = Array.isArray(response.data) ? response.data : [];
    }

    if (!Array.isArray(itemsToIngest) || itemsToIngest.length === 0) {
      return res.json({
        success: true,
        message: 'No items found in dataset to sync',
        data: { total: 0, inserted: 0, skipped: 0, dataset_id: resolvedDatasetId }
      });
    }

    let insertedCount = 0;
    let skippedCount = 0;
    const insertedIds = [];

    for (const item of itemsToIngest) {
      if (!item || typeof item !== 'object') {
        skippedCount++;
        continue;
      }

      const url = (item.url || item.loadedUrl || item.link || '').trim();
      const title = (item.judul || item.title || item.pageTitle || item.headline || '').trim();
      const titleTh = (item.title_th || item.titleTh || item.judul || item.title || '').trim();
      let source = (item.sumber || item.source || '').trim();
      if (!source && url) {
        try {
          source = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          source = 'News Scraper';
        }
      }
      const publishDate = (item.tanggal || item.publish_date || item.publishDate || item.date || '').trim();
      const contentRaw = (item.konten || item.content || item.content_raw || item.text || item.body || '').trim();
      const isForeign = Boolean(item.is_foreign || item.isForeign || false);

      // Skip debug-only rows or entries without title
      if (!title) {
        skippedCount++;
        continue;
      }

      // Check if URL or title already exists in MySQL staging
      if (url) {
        const [existing] = await pool.query('SELECT id FROM articles WHERE url = ? LIMIT 1', [url]);
        if (existing.length > 0) {
          skippedCount++;
          continue;
        }
      } else if (title) {
        const [existing] = await pool.query('SELECT id FROM articles WHERE title = ? LIMIT 1', [title]);
        if (existing.length > 0) {
          skippedCount++;
          continue;
        }
      }

      // Insert new article into staging table with SCRAPED status
      const [insertResult] = await pool.query(
        `INSERT INTO articles (title, title_th, url, source, publish_date, content_raw, is_foreign, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SCRAPED')`,
        [title, titleTh || title, url || null, source || 'Apify Scraper', publishDate || null, contentRaw || null, isForeign ? 1 : 0]
      );

      insertedCount++;
      insertedIds.push(insertResult.insertId);
    }

    return res.json({
      success: true,
      message: `Sync completed: ${insertedCount} new articles staged into MySQL (${skippedCount} duplicates/empty skipped).`,
      data: {
        total: itemsToIngest.length,
        dataset_id: resolvedDatasetId,
        inserted: insertedCount,
        skipped: skippedCount,
        inserted_ids: insertedIds
      }
    });
  } catch (error) {
    console.error('syncDatasetToMySQL error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to sync Apify dataset to MySQL',
      error: error.response?.data?.error?.message || error.message
    });
  }
};
