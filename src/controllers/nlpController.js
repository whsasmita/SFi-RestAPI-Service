import axios from 'axios';

const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL || 'http://localhost:8000';

/**
 * Helper to produce informative error responses for upstream Python NLP failures
 */
const formatNlpError = (error, defaultMessage, articleId = null) => {
  let statusCode = 500;
  let errorDetail = error.message;

  if (error.code === 'ECONNREFUSED') {
    statusCode = 503;
    errorDetail = `Python NLP Microservice is offline or unreachable at ${NLP_SERVICE_URL}. Please ensure the Python FastAPI service is running on port 8000.`;
  } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    statusCode = 504;
    errorDetail = `NLP pipeline processing timed out. Processing multi-chunk articles with NLLB-200 and BERT NER requires more time.`;
  } else if (error.response) {
    statusCode = error.response.status || 500;
    errorDetail = error.response.data?.detail || error.response.data?.message || JSON.stringify(error.response.data);
  }

  const prefix = articleId ? `Failed to process article #${articleId}` : defaultMessage;
  const message = errorDetail ? `${prefix} (${errorDetail})` : prefix;

  return {
    statusCode,
    body: {
      success: false,
      message,
      error: errorDetail,
      code: error.code || (error.response ? `HTTP_${error.response.status}` : 'INTERNAL_ERROR'),
      articleId: articleId ? Number(articleId) : undefined,
    },
  };
};

/**
 * Check Python NLP Microservice health & PyTorch GPU/CPU availability
 */
export const getNlpHealth = async (req, res) => {
  try {
    const response = await axios.get(`${NLP_SERVICE_URL}/api/nlp/health`, { timeout: 5000 });
    return res.json({
      success: true,
      service_url: NLP_SERVICE_URL,
      data: response.data,
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: 'Python NLP Microservice is unavailable or not running on port 8000',
      error: error.message,
    });
  }
};

/**
 * Trigger Step 1: Preprocessing & Translation for single article
 */
export const triggerTranslation = async (req, res) => {
  const { articleId } = req.params;
  try {
    const response = await axios.post(`${NLP_SERVICE_URL}/api/nlp/translate/${articleId}`, {}, { timeout: 180000 });
    return res.json(response.data);
  } catch (error) {
    console.error(`triggerTranslation error [Article #${articleId}]:`, error.response?.data || error.message);
    const { statusCode, body } = formatNlpError(error, `Failed to translate article #${articleId}`, articleId);
    return res.status(statusCode).json(body);
  }
};

/**
 * Trigger Step 2: Dual-Track NER, Fusion & OSM Geocoding for single article
 */
export const triggerExtraction = async (req, res) => {
  const { articleId } = req.params;
  try {
    const response = await axios.post(`${NLP_SERVICE_URL}/api/nlp/extract/${articleId}`, {}, { timeout: 180000 });
    return res.json(response.data);
  } catch (error) {
    console.error(`triggerExtraction error [Article #${articleId}]:`, error.response?.data || error.message);
    const { statusCode, body } = formatNlpError(error, `Failed to extract entities for article #${articleId}`, articleId);
    return res.status(statusCode).json(body);
  }
};

/**
 * Trigger Complete Pipeline (Translation + NER + Geocoding) for single article
 */
export const triggerFullProcessing = async (req, res) => {
  const { articleId } = req.params;
  try {
    const response = await axios.post(`${NLP_SERVICE_URL}/api/nlp/process-full/${articleId}`, {}, { timeout: 300000 });
    return res.json(response.data);
  } catch (error) {
    console.error(`triggerFullProcessing error [Article #${articleId}]:`, error.response?.data || error.message);
    const { statusCode, body } = formatNlpError(error, `Failed to execute full NLP pipeline for article #${articleId}`, articleId);
    return res.status(statusCode).json(body);
  }
};

/**
 * Trigger Batch Processing
 */
export const triggerBatchProcessing = async (req, res) => {
  try {
    const response = await axios.post(`${NLP_SERVICE_URL}/api/nlp/batch-process`, req.body, { timeout: 600000 });
    return res.json(response.data);
  } catch (error) {
    console.error('triggerBatchProcessing error:', error.response?.data || error.message);
    const { statusCode, body } = formatNlpError(error, 'Failed to execute batch NLP processing');
    return res.status(statusCode).json(body);
  }
};
