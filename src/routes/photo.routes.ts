import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const photos = await prisma.photo.findMany({ where: { approved: true }, orderBy: { createdAt: 'desc' } });
    res.json({ status: 'success', data: photos });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const photo = await prisma.photo.create({ data: req.body });
    res.status(201).json({ status: 'success', data: photo });
  } catch (error) { next(error); }
});
export default router;
