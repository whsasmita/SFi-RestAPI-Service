import pool from '../config/db.js';

// Get paginated articles with filter
export const getArticles = async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const parsedLimit = parseInt(limit, 10);

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (title LIKE ? OR title_en LIKE ? OR title_th LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM articles ${whereClause}`, params);
    const total = countRows[0].total;

    const [articles] = await pool.query(
      `SELECT * FROM articles ${whereClause} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, parsedLimit, offset]
    );

    return res.json({
      success: true,
      data: articles,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    console.error('getArticles error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch articles', error: error.message });
  }
};

// Get single article detail with extracted locations, impacts, and times
export const getArticleById = async (req, res) => {
  try {
    const { id } = req.params;
    const [articles] = await pool.query('SELECT * FROM articles WHERE id = ?', [id]);
    if (articles.length === 0) {
      return res.status(404).json({ success: false, message: 'Article not found' });
    }

    const article = articles[0];
    const [locations] = await pool.query('SELECT * FROM article_locations WHERE article_id = ?', [id]);
    const [impacts] = await pool.query('SELECT * FROM article_impacts WHERE article_id = ?', [id]);
    const [times] = await pool.query('SELECT * FROM article_times WHERE article_id = ?', [id]);

    return res.json({
      success: true,
      data: {
        ...article,
        locations,
        impacts,
        times
      }
    });
  } catch (error) {
    console.error('getArticleById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch article details', error: error.message });
  }
};

// Create new article manually / via scraper
export const createArticle = async (req, res) => {
  try {
    const { title, title_th, title_en, url, source, publish_date, content_raw, content_summary_en, is_foreign = false } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const [result] = await pool.query(
      `INSERT INTO articles (title, title_th, title_en, url, source, publish_date, content_raw, content_summary_en, is_foreign, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCRAPED')`,
      [title, title_th, title_en, url, source, publish_date, content_raw, content_summary_en, is_foreign]
    );

    return res.status(201).json({
      success: true,
      message: 'Article created successfully',
      data: { id: result.insertId, title }
    });
  } catch (error) {
    console.error('createArticle error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create article', error: error.message });
  }
};

// Update location validation status / semantic role / metadata
export const updateLocationValidation = async (req, res) => {
  try {
    const { locationId } = req.params;
    const {
      text_en,
      text_th,
      admin_level,
      category,
      formatted_address,
      semantic_role,
      validation_status,
      lat,
      lng
    } = req.body;

    const updates = [];
    const params = [];

    if (text_en !== undefined) {
      updates.push('text_en = ?');
      params.push(text_en);
    }
    if (text_th !== undefined) {
      updates.push('text_th = ?');
      params.push(text_th);
    }
    if (admin_level !== undefined) {
      updates.push('admin_level = ?');
      params.push(admin_level);
    }
    if (category !== undefined) {
      updates.push('category = ?');
      params.push(category);
    }
    if (formatted_address !== undefined) {
      updates.push('formatted_address = ?');
      params.push(formatted_address);
    }
    if (semantic_role) {
      updates.push('semantic_role = ?');
      params.push(semantic_role);
    }
    if (validation_status) {
      updates.push('validation_status = ?');
      params.push(validation_status);
    }
    if (lat !== undefined) {
      updates.push('lat = ?');
      params.push(lat);
    }
    if (lng !== undefined) {
      updates.push('lng = ?');
      params.push(lng);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    params.push(locationId);
    await pool.query(`UPDATE article_locations SET ${updates.join(', ')} WHERE id = ?`, params);

    return res.json({ success: true, message: 'Location updated successfully' });
  } catch (error) {
    console.error('updateLocationValidation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update location', error: error.message });
  }
};

// Create a new location entity manually for an article
export const createLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      text_en = '',
      text_th = '',
      admin_level = 6,
      category = 'GENERAL_LOCATION',
      lat = null,
      lng = null,
      formatted_address = '',
      semantic_role = 'FLOOD',
      validation_status = 'APPROVED'
    } = req.body;

    if (!text_en && !text_th) {
      return res.status(400).json({ success: false, message: 'Location name (English or Thai) is required' });
    }

    const baseName = (text_en || text_th || 'loc').trim().toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '_');
    const node_id = `manual_${id}_${baseName}_${Date.now().toString().slice(-4)}`;

    const [result] = await pool.query(
      `INSERT INTO article_locations 
       (article_id, node_id, text_th, text_en, admin_level, category, lat, lng, formatted_address, geocode_level, geocode_source, geocode_confidence, semantic_role, validation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_CURATED', 'ADMIN_CURATOR', 1.0, ?, ?)`,
      [
        id,
        node_id,
        text_th || text_en,
        text_en || text_th,
        parseInt(admin_level, 10) || 6,
        category,
        lat !== null && lat !== '' ? parseFloat(lat) : null,
        lng !== null && lng !== '' ? parseFloat(lng) : null,
        formatted_address || null,
        semantic_role,
        validation_status
      ]
    );

    const [rows] = await pool.query('SELECT * FROM article_locations WHERE id = ?', [result.insertId]);
    return res.status(201).json({
      success: true,
      message: 'Location added successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('createLocation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create location', error: error.message });
  }
};

// Delete location entity
export const deleteLocation = async (req, res) => {
  try {
    const { locationId } = req.params;
    await pool.query('DELETE FROM article_locations WHERE id = ?', [locationId]);
    return res.json({ success: true, message: 'Location deleted successfully' });
  } catch (error) {
    console.error('deleteLocation error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete location', error: error.message });
  }
};

// 1-Click Approve All Valid Locations & Mark Article as VALIDATED
export const approveAllArticleEntities = async (req, res) => {
  try {
    const { id } = req.params;

    const [locResult] = await pool.query(
      `UPDATE article_locations 
       SET validation_status = 'APPROVED' 
       WHERE article_id = ? 
         AND lat IS NOT NULL 
         AND lng IS NOT NULL 
         AND validation_status != 'REJECTED'`,
      [id]
    );

    await pool.query(
      `UPDATE article_impacts 
       SET validation_status = 'APPROVED' 
       WHERE article_id = ? AND validation_status != 'REJECTED'`,
      [id]
    );

    await pool.query(
      `UPDATE articles 
       SET status = CASE WHEN status = 'PUBLISHED_TO_KG' THEN 'PUBLISHED_TO_KG' ELSE 'VALIDATED' END
       WHERE id = ?`,
      [id]
    );

    return res.json({
      success: true,
      message: `Article #${id} marked as VALIDATED (${locResult.affectedRows} locations approved).`,
      approvedLocationsCount: locResult.affectedRows
    });
  } catch (error) {
    console.error('approveAllArticleEntities error:', error);
    return res.status(500).json({ success: false, message: 'Failed to approve article entities', error: error.message });
  }
};

// Create Impact Metric
export const createImpact = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      impact_type = 'GeneralImpact',
      raw_expression = '',
      quantity_value = null,
      unit = '',
      validation_status = 'APPROVED'
    } = req.body;

    if (!raw_expression) {
      return res.status(400).json({ success: false, message: 'Raw expression is required' });
    }

    const parsedVal = quantity_value !== null && quantity_value !== '' ? parseFloat(quantity_value) : null;
    const [result] = await pool.query(
      `INSERT INTO article_impacts (article_id, impact_type, raw_expression, quantity_value, unit, validation_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, impact_type, raw_expression, parsedVal, unit || null, validation_status]
    );

    const [rows] = await pool.query('SELECT * FROM article_impacts WHERE id = ?', [result.insertId]);
    return res.status(201).json({
      success: true,
      message: 'Impact metric added successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('createImpact error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create impact metric', error: error.message });
  }
};

// Update Impact Metric
export const updateImpact = async (req, res) => {
  try {
    const { impactId } = req.params;
    const { impact_type, raw_expression, quantity_value, unit, validation_status } = req.body;

    const updates = [];
    const params = [];

    if (impact_type !== undefined) {
      updates.push('impact_type = ?');
      params.push(impact_type);
    }
    if (raw_expression !== undefined) {
      updates.push('raw_expression = ?');
      params.push(raw_expression);
    }
    if (quantity_value !== undefined) {
      updates.push('quantity_value = ?');
      params.push(quantity_value !== null && quantity_value !== '' ? parseFloat(quantity_value) : null);
    }
    if (unit !== undefined) {
      updates.push('unit = ?');
      params.push(unit || null);
    }
    if (validation_status !== undefined) {
      updates.push('validation_status = ?');
      params.push(validation_status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    params.push(impactId);
    await pool.query(`UPDATE article_impacts SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query('SELECT * FROM article_impacts WHERE id = ?', [impactId]);
    return res.json({
      success: true,
      message: 'Impact metric updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('updateImpact error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update impact metric', error: error.message });
  }
};

// Delete Impact Metric
export const deleteImpact = async (req, res) => {
  try {
    const { impactId } = req.params;
    await pool.query('DELETE FROM article_impacts WHERE id = ?', [impactId]);
    return res.json({ success: true, message: 'Impact metric deleted successfully' });
  } catch (error) {
    console.error('deleteImpact error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete impact metric', error: error.message });
  }
};

// Create Temporal Mention
export const createTime = async (req, res) => {
  try {
    const { id } = req.params;
    const { time_expression = '', calendar_system = 'CommonEra' } = req.body;

    if (!time_expression) {
      return res.status(400).json({ success: false, message: 'Time expression is required' });
    }

    const [result] = await pool.query(
      `INSERT INTO article_times (article_id, time_expression, calendar_system)
       VALUES (?, ?, ?)`,
      [id, time_expression, calendar_system]
    );

    const [rows] = await pool.query('SELECT * FROM article_times WHERE id = ?', [result.insertId]);
    return res.status(201).json({
      success: true,
      message: 'Temporal mention added successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('createTime error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create temporal mention', error: error.message });
  }
};

// Update Temporal Mention
export const updateTime = async (req, res) => {
  try {
    const { timeId } = req.params;
    const { time_expression, calendar_system } = req.body;

    const updates = [];
    const params = [];

    if (time_expression !== undefined) {
      updates.push('time_expression = ?');
      params.push(time_expression);
    }
    if (calendar_system !== undefined) {
      updates.push('calendar_system = ?');
      params.push(calendar_system);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    params.push(timeId);
    await pool.query(`UPDATE article_times SET ${updates.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query('SELECT * FROM article_times WHERE id = ?', [timeId]);
    return res.json({
      success: true,
      message: 'Temporal mention updated successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('updateTime error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update temporal mention', error: error.message });
  }
};

// Delete Temporal Mention
export const deleteTime = async (req, res) => {
  try {
    const { timeId } = req.params;
    await pool.query('DELETE FROM article_times WHERE id = ?', [timeId]);
    return res.json({ success: true, message: 'Temporal mention deleted successfully' });
  } catch (error) {
    console.error('deleteTime error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete temporal mention', error: error.message });
  }
};

// Update article fields (translation, summary, status)
export const updateArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const { title_en, title_th, content_en, content_th, content_summary_en, status, is_foreign } = req.body;

    const updates = [];
    const params = [];

    if (title_en !== undefined) {
      updates.push('title_en = ?');
      params.push(title_en);
    }
    if (title_th !== undefined) {
      updates.push('title_th = ?');
      params.push(title_th);
    }
    if (content_en !== undefined) {
      updates.push('content_en = ?');
      params.push(content_en);
    }
    if (content_th !== undefined) {
      updates.push('content_th = ?');
      params.push(content_th);
    }
    if (content_summary_en !== undefined) {
      updates.push('content_summary_en = ?');
      params.push(content_summary_en);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }
    if (is_foreign !== undefined) {
      updates.push('is_foreign = ?');
      params.push(is_foreign);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    params.push(id);
    await pool.query(`UPDATE articles SET ${updates.join(', ')} WHERE id = ?`, params);

    return res.json({ success: true, message: `Article #${id} updated successfully` });
  } catch (error) {
    console.error('updateArticle error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update article', error: error.message });
  }
};

// Batch update status for multiple selected articles (Admin multi-select)
export const batchUpdateArticleStatus = async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'Array of article IDs (ids) is required' });
    }

    const allowedStatuses = ['SCRAPED', 'PROCESSING', 'VALIDATED', 'PUBLISHED_TO_KG', 'REJECTED'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`
      });
    }

    const [result] = await pool.query(
      `UPDATE articles SET status = ? WHERE id IN (?)`,
      [status, ids]
    );

    // If batch validating, auto-approve non-rejected locations with coordinates and impacts
    if (status === 'VALIDATED') {
      await pool.query(
        `UPDATE article_locations 
         SET validation_status = 'APPROVED' 
         WHERE article_id IN (?) 
           AND lat IS NOT NULL 
           AND lng IS NOT NULL 
           AND validation_status != 'REJECTED'`,
        [ids]
      );

      await pool.query(
        `UPDATE article_impacts 
         SET validation_status = 'APPROVED' 
         WHERE article_id IN (?) AND validation_status != 'REJECTED'`,
        [ids]
      );
    }

    return res.json({
      success: true,
      message: `Successfully updated ${result.affectedRows} articles to ${status}`,
      affectedCount: result.affectedRows,
      updatedStatus: status
    });
  } catch (error) {
    console.error('batchUpdateArticleStatus error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to batch update article status',
      error: error.message
    });
  }
};


