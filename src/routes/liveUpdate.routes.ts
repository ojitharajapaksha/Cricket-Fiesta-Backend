import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const updates = await prisma.liveUpdate.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ status: 'success', data: updates });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const update = await prisma.liveUpdate.create({ data: req.body });
    res.status(201).json({ status: 'success', data: update });
  } catch (error) { next(error); }
});
export default router;
