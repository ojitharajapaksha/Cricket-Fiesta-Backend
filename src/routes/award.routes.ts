import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const awards = await prisma.award.findMany({ include: { winner: true } });
    res.json({ status: 'success', data: awards });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const award = await prisma.award.create({ data: req.body });
    res.status(201).json({ status: 'success', data: award });
  } catch (error) { next(error); }
});
export default router;
