import { Router } from 'express';
import {
  getCrawlerConfig,
  getCrawlerUsageStats,
  triggerCrawlerTask,
  getCrawlerRunStatus,
  syncDatasetToMySQL
} from '../controllers/crawlerController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/config', verifyToken, getCrawlerConfig);
router.get('/stats', verifyToken, getCrawlerUsageStats);
router.get('/usage', verifyToken, getCrawlerUsageStats);
router.post('/trigger', verifyToken, triggerCrawlerTask);
router.get('/status/:runId', verifyToken, getCrawlerRunStatus);
router.post('/sync', verifyToken, syncDatasetToMySQL);

export default router;
