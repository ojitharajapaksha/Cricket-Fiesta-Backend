import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const incidents = await prisma.incident.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ status: 'success', data: incidents });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const incident = await prisma.incident.create({ data: req.body });
    res.status(201).json({ status: 'success', data: incident });
  } catch (error) { next(error); }
});
export default router;
