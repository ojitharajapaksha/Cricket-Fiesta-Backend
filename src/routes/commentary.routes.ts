import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/match/:matchId', async (req, res, next) => {
  try {
    const commentary = await prisma.commentary.findMany({
      where: { matchId: req.params.matchId },
      orderBy: { timestamp: 'desc' },
    });
    res.json({ status: 'success', data: commentary });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const comment = await prisma.commentary.create({ data: req.body });
    res.status(201).json({ status: 'success', data: comment });
  } catch (error) { next(error); }
});
export default router;
