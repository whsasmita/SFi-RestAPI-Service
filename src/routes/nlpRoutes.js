import { Router } from 'express';
import {
  getNlpHealth,
  triggerTranslation,
  triggerExtraction,
  triggerFullProcessing,
  triggerBatchProcessing
} from '../controllers/nlpController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/health', verifyToken, getNlpHealth);
router.post('/translate/:articleId', verifyToken, triggerTranslation);
router.post('/extract/:articleId', verifyToken, triggerExtraction);
router.post('/process-full/:articleId', verifyToken, triggerFullProcessing);
router.post('/batch', verifyToken, triggerBatchProcessing);

export default router;
