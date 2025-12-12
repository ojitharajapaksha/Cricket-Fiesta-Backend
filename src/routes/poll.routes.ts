import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();
router.get('/', async (req, res, next) => {
  try {
    const polls = await prisma.poll.findMany({ where: { active: true } });
    res.json({ status: 'success', data: polls });
  } catch (error) { next(error); }
});
router.post('/:id/vote', async (req, res, next) => {
  try {
    const poll = await prisma.poll.findUnique({ where: { id: req.params.id } });
    res.json({ status: 'success', data: poll });
  } catch (error) { next(error); }
});
export default router;
