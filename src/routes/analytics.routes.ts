import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.post('/track', async (req, res, next) => {
  try {
    const analytic = await prisma.analytics.create({ data: req.body });
    res.status(201).json({ status: 'success', data: analytic });
  } catch (error) { next(error); }
});
router.get('/', async (req, res, next) => {
  try {
    const analytics = await prisma.analytics.findMany({ orderBy: { timestamp: 'desc' }, take: 100 });
    res.json({ status: 'success', data: analytics });
  } catch (error) { next(error); }
});
export default router;
