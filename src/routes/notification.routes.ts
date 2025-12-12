import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ status: 'success', data: notifications });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const notification = await prisma.notification.create({ data: req.body });
    res.status(201).json({ status: 'success', data: notification });
  } catch (error) { next(error); }
});
export default router;
