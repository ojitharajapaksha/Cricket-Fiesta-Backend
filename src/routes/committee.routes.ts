import { Router } from 'express';
import { prisma } from '../utils/prisma';
const router = Router();

// Get public committee members (for OC Members page - no auth required)
// Only shows committee members approved by super admin
router.get('/public', async (req, res, next) => {
  try {
    const members = await prisma.committee.findMany({
      where: {
        isApproved: true  // Only show approved OC members on public page
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        imageUrl: true,
        department: true,
      },
      orderBy: [
        { role: 'asc' },
        { fullName: 'asc' }
      ]
    });
    res.json({ status: 'success', data: members });
  } catch (error) { next(error); }
});

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

    // Helper function to find column value by partial key match
    const findValue = (obj: any, ...searchTerms: string[]) => {
      for (const term of searchTerms) {
        // First try exact match
        if (obj[term] !== undefined) return obj[term];
        // Then try partial match (case-insensitive)
        const key = Object.keys(obj).find(k => k.toLowerCase().includes(term.toLowerCase()));
        if (key && obj[key] !== undefined) return obj[key];
      }
      return undefined;
    };

    for (const member of members) {
      try {
        // Find the correct column names from Google Form export using flexible matching
        const fullName = findValue(member, 'Full Name', 'fullName', 'Name');
        const department = findValue(member, 'Department', 'department');
        const whatsappNumber = findValue(member, 'WhatsApp Number', 'WhatsApp', 'whatsappNumber') || '';
        const emergencyContact = findValue(member, 'Emergency Contact', 'emergencyContact');
        const assignedTeam = findValue(member, 'Assigned Team', 'Team', 'assignedTeam');
        
        // Get email - could be in multiple columns from Google Form
        const email = findValue(member, 'Email Address', 'Email', 'email');
        
        // Parse experience level from the long column name
        // Enum values: BEGINNER, INTERMEDIATE, ADVANCED, PROFESSIONAL
        const experienceKey = Object.keys(member).find(key => 
          key.toLowerCase().includes('prior experience') || 
          key.toLowerCase().includes('experience')
        );
        let experienceLevel = 'BEGINNER';
        if (experienceKey && member[experienceKey]) {
          const exp = member[experienceKey].toLowerCase();
          if (exp.includes('extensive') || exp.includes('3+')) {
            experienceLevel = 'PROFESSIONAL';
          } else if (exp.includes('some experience')) {
            experienceLevel = 'INTERMEDIATE';
          } else if (exp.includes('eager') || exp.includes('no,') || exp.includes('but eager')) {
            experienceLevel = 'BEGINNER';
          }
        }
        
        // Parse availability columns
        const availabilityPlanning = Object.keys(member).some(key => 
          key.toLowerCase().includes('planning') && 
          member[key]?.toLowerCase()?.includes('fully available')
        );
        const availabilitySetup = Object.keys(member).some(key => 
          key.toLowerCase().includes('setup') && 
          member[key]?.toLowerCase()?.includes('fully available')
        );
        const availabilityMorning = Object.keys(member).some(key => 
          key.toLowerCase().includes('morning') && 
          member[key]?.toLowerCase()?.includes('fully available')
        );
        const availabilityAfternoon = Object.keys(member).some(key => 
          key.toLowerCase().includes('afternoon') && 
          member[key]?.toLowerCase()?.includes('fully available')
        );

        if (!fullName) {
          throw new Error('Full Name is required');
        }

        await prisma.committee.create({
          data: {
            fullName: fullName.trim(),
            department: department?.trim() || 'Unknown',
            whatsappNumber: whatsappNumber?.toString().trim() || '',
            email: email?.trim(),
            assignedTeam: assignedTeam?.trim(),
            experienceLevel: experienceLevel as any,
            emergencyContact: emergencyContact?.toString().trim(),
            availabilityPlanning,
            availabilitySetup,
            availabilityMorning,
            availabilityAfternoon,
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

// Check-in committee member by email (for auto check-in on dashboard login)
// NOTE: This route must come BEFORE /:id/check-in to avoid route conflicts
router.post('/check-in-by-email', async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ status: 'error', message: 'Email is required' });
    }

    // Find committee member by email (case-insensitive)
    const member = await prisma.committee.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } }
    });

    if (!member) {
      return res.status(404).json({ status: 'error', message: 'Committee member not found' });
    }

    // Only check-in if not already checked in
    if (!member.checkedIn) {
      const updatedMember = await prisma.committee.update({
        where: { id: member.id },
        data: {
          checkedIn: true,
          checkInTime: new Date()
        }
      });
      return res.json({ status: 'success', data: updatedMember, message: 'Checked in successfully' });
    }

    res.json({ status: 'success', data: member, message: 'Already checked in' });
  } catch (error) { next(error); }
});

// Check-in a committee member by ID
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

// Update committee member (including role and imageUrl)
router.put('/:id', async (req, res, next) => {
  try {
    const { fullName, role, imageUrl, department, whatsappNumber, emergencyContact, email, assignedTeam, experienceLevel } = req.body;
    
    const member = await prisma.committee.update({
      where: { id: req.params.id },
      data: {
        ...(fullName && { fullName }),
        ...(role !== undefined && { role }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(department && { department }),
        ...(whatsappNumber && { whatsappNumber }),
        ...(emergencyContact !== undefined && { emergencyContact }),
        ...(email !== undefined && { email }),
        ...(assignedTeam !== undefined && { assignedTeam }),
        ...(experienceLevel && { experienceLevel }),
      }
    });
    res.json({ status: 'success', data: member });
  } catch (error) { next(error); }
});

// Update committee member profile image by email (for logged in OC members)
router.put('/profile-image/by-email', async (req, res, next) => {
  try {
    const { email, imageUrl } = req.body;
    
    if (!email || !imageUrl) {
      return res.status(400).json({ status: 'error', message: 'Email and image URL are required' });
    }
    
    // Find committee member by email
    const member = await prisma.committee.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } }
    });
    
    if (!member) {
      return res.status(404).json({ status: 'error', message: 'Committee member not found' });
    }
    
    // Update profile image
    const updated = await prisma.committee.update({
      where: { id: member.id },
      data: { imageUrl }
    });
    
    res.json({
      status: 'success',
      message: 'Profile image updated successfully',
      data: updated
    });
  } catch (error) { next(error); }
});

// Toggle committee member approval status for public page visibility (Super Admin only)
router.put('/:id/approval', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isApproved } = req.body;
    
    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'isApproved must be a boolean' });
    }
    
    const member = await prisma.committee.findUnique({ where: { id } });
    if (!member) {
      return res.status(404).json({ status: 'error', message: 'Committee member not found' });
    }
    
    const updated = await prisma.committee.update({
      where: { id },
      data: { isApproved }
    });
    
    res.json({
      status: 'success',
      message: `Committee member ${isApproved ? 'approved' : 'unapproved'} for public page`,
      data: updated
    });
  } catch (error) { next(error); }
});

// Bulk approve/unapprove committee members (Super Admin only)
router.put('/bulk-approval', async (req, res, next) => {
  try {
    const { memberIds, isApproved } = req.body;
    
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ status: 'error', message: 'memberIds must be a non-empty array' });
    }
    
    if (typeof isApproved !== 'boolean') {
      return res.status(400).json({ status: 'error', message: 'isApproved must be a boolean' });
    }
    
    const result = await prisma.committee.updateMany({
      where: { id: { in: memberIds } },
      data: { isApproved }
    });
    
    res.json({
      status: 'success',
      message: `${result.count} committee members ${isApproved ? 'approved' : 'unapproved'} for public page`,
      data: { count: result.count }
    });
  } catch (error) { next(error); }
});

export default router;
