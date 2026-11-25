import { Router } from 'express';
import { publishArticleToKG, publishBatchValidatedToKG, getPipelineHealth } from '../controllers/pipelineController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();

router.post('/publish-batch', verifyToken, publishBatchValidatedToKG);
router.post('/publish/:articleId', verifyToken, publishArticleToKG);
router.get('/health', verifyToken, getPipelineHealth);

export default router;
