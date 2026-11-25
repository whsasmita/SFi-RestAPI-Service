import { Router } from 'express';
import {
  getArticles,
  getArticleById,
  createArticle,
  updateArticle,
  batchUpdateArticleStatus,
  approveAllArticleEntities,
  createLocation,
  updateLocationValidation,
  deleteLocation,
  createImpact,
  updateImpact,
  deleteImpact,
  createTime,
  updateTime,
  deleteTime
} from '../controllers/articleController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();

// Article Routes
router.get('/', verifyToken, getArticles);
router.patch('/batch-status', verifyToken, batchUpdateArticleStatus);
router.get('/:id', verifyToken, getArticleById);
router.post('/', verifyToken, createArticle);
router.patch('/:id', verifyToken, updateArticle);
router.post('/:id/approve-all', verifyToken, approveAllArticleEntities);

// Location CRUD Routes
router.post('/:id/locations', verifyToken, createLocation);
router.patch('/locations/:locationId', verifyToken, updateLocationValidation);
router.delete('/locations/:locationId', verifyToken, deleteLocation);

// Impact CRUD Routes
router.post('/:id/impacts', verifyToken, createImpact);
router.patch('/impacts/:impactId', verifyToken, updateImpact);
router.delete('/impacts/:impactId', verifyToken, deleteImpact);

// Temporal Mention CRUD Routes
router.post('/:id/times', verifyToken, createTime);
router.patch('/times/:timeId', verifyToken, updateTime);
router.delete('/times/:timeId', verifyToken, deleteTime);

export default router;
