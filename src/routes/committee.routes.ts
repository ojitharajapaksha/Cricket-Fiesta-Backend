import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();

// Get all committee members
router.get('/', async (req, res, next) => {
  try {
    const members = await prisma.committee.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ status: 'success', data: members });
  } catch (error) { next(error); }
});

// Create new committee member
router.post('/', async (req, res, next) => {
  try {
    const member = await prisma.committee.create({ data: req.body });
    res.status(201).json({ status: 'success', data: member });
  } catch (error) { next(error); }
});

// Bulk import committee members
router.post('/bulk-import', async (req, res, next) => {
  try {
    const { members } = req.body;
    const results = { imported: 0, failed: 0, errors: [] as string[] };

    for (const member of members) {
      try {
        await prisma.committee.create({
          data: {
            fullName: member['Full Name'] || member.fullName,
            department: member.Department || member.department,
            whatsappNumber: member.WhatsApp || member.whatsappNumber,
            email: member.Email || member.email,
            assignedTeam: member.Team || member.assignedTeam,
            experienceLevel: (member.Experience || member.experienceLevel || 'NONE').toUpperCase(),
            emergencyContact: member['Emergency Contact'] || member.emergencyContact,
          }
        });
        results.imported++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(`Row ${member.rowNumber || '?'}: ${error.message}`);
      }
    }

    res.json({ status: 'success', data: results });
  } catch (error) { next(error); }
});

// Check-in a committee member
router.post('/:id/check-in', async (req, res, next) => {
  try {
    const member = await prisma.committee.update({
      where: { id: req.params.id },
      data: {
        checkedIn: true,
        checkInTime: new Date()
      }
    });
    res.json({ status: 'success', data: member });
  } catch (error) { next(error); }
});

// Check-out a committee member
router.post('/:id/check-out', async (req, res, next) => {
  try {
    const member = await prisma.committee.update({
      where: { id: req.params.id },
      data: {
        checkedIn: false,
        checkOutTime: new Date()
      }
    });
    res.json({ status: 'success', data: member });
  } catch (error) { next(error); }
});

// Delete committee member
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.committee.delete({
      where: { id: req.params.id }
    });
    res.json({ status: 'success', message: 'Committee member deleted' });
  } catch (error) { next(error); }
});

export default router;
