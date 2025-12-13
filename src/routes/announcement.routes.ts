import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// Get active announcements (public - for home page)
router.get('/active', async (req, res, next) => {
  try {
    const now = new Date();
    const announcements = await prisma.announcement.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        OR: [
          { endDate: null },
          { endDate: { gte: now } }
        ]
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });
    res.json({ status: 'success', data: announcements });
  } catch (error) { next(error); }
});

// Get all announcements (admin only)
router.get('/', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const announcements = await prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ status: 'success', data: announcements });
  } catch (error) { next(error); }
});

// Get single announcement
router.get('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const announcement = await prisma.announcement.findUnique({
      where: { id: req.params.id }
    });
    if (!announcement) {
      return res.status(404).json({ status: 'error', message: 'Announcement not found' });
    }
    res.json({ status: 'success', data: announcement });
  } catch (error) { next(error); }
});

// Create announcement (Super Admin only)
router.post('/', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { title, content, imageUrl, linkUrl, linkText, type, isActive, priority, startDate, endDate } = req.body;
    
    const announcement = await prisma.announcement.create({
      data: {
        title,
        content,
        imageUrl,
        linkUrl,
        linkText,
        type: type || 'INFO',
        isActive: isActive !== false,
        priority: priority || 0,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        createdBy: (req as any).user.id
      }
    });
    
    res.status(201).json({ status: 'success', data: announcement });
  } catch (error) { next(error); }
});

// Update announcement (Super Admin only)
router.put('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { title, content, imageUrl, linkUrl, linkText, type, isActive, priority, startDate, endDate } = req.body;
    
    const announcement = await prisma.announcement.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(linkUrl !== undefined && { linkUrl }),
        ...(linkText !== undefined && { linkText }),
        ...(type && { type }),
        ...(isActive !== undefined && { isActive }),
        ...(priority !== undefined && { priority }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null })
      }
    });
    
    res.json({ status: 'success', data: announcement });
  } catch (error) { next(error); }
});

// Toggle announcement active status
router.patch('/:id/toggle', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const announcement = await prisma.announcement.findUnique({
      where: { id: req.params.id }
    });
    
    if (!announcement) {
      return res.status(404).json({ status: 'error', message: 'Announcement not found' });
    }
    
    const updated = await prisma.announcement.update({
      where: { id: req.params.id },
      data: { isActive: !announcement.isActive }
    });
    
    res.json({ status: 'success', data: updated });
  } catch (error) { next(error); }
});

// Delete announcement (Super Admin only)
router.delete('/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    await prisma.announcement.delete({
      where: { id: req.params.id }
    });
    res.json({ status: 'success', message: 'Announcement deleted' });
  } catch (error) { next(error); }
});

export default router;
