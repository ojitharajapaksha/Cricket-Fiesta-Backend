import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { UserRole, ApprovalStatus } from '@prisma/client';

const router = Router();

// User login (Gmail from Google Form registration - Players or Food Registrants)
router.post('/login/user', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Check if player exists with this email
    const player = await prisma.player.findFirst({
      where: { email },
      include: { user: true }
    });

    // If player found, login as player
    if (player) {
      let user = player.user;
      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            firstName: player.fullName.split(' ')[0],
            lastName: player.fullName.split(' ').slice(1).join(' '),
            role: UserRole.USER,
            approvalStatus: ApprovalStatus.APPROVED,
            playerId: player.id,
          }
        });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      return res.json({
        status: 'success',
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            playerId: player.id
          }
        }
      });
    }

    // Check if food registrant exists with this email
    const foodRegistrant = await prisma.foodRegistration.findFirst({
      where: { email }
    });

    if (foodRegistrant) {
      let user = await prisma.user.findFirst({
        where: { email }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            firstName: foodRegistrant.fullName.split(' ')[0],
            lastName: foodRegistrant.fullName.split(' ').slice(1).join(' '),
            role: UserRole.USER,
            approvalStatus: ApprovalStatus.APPROVED,
            traineeId: foodRegistrant.traineeId,
          }
        });
      }

      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      return res.json({
        status: 'success',
        data: {
          token,
          user: {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            foodRegistrationId: foodRegistrant.id
          }
        }
      });
    }

    // Neither player nor food registrant found
    throw new AppError('No registration found with this email. Please register through Google Form first.', 404);
  } catch (error) {
    next(error);
  }
});

// Admin/Super Admin login (Email + Password)
router.post('/login/admin', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400);
    }

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !user.password) {
      throw new AppError('Invalid email or password', 401);
    }

    // Check if admin is approved
    if (user.role === UserRole.ADMIN && user.approvalStatus !== ApprovalStatus.APPROVED) {
      throw new AppError('Your account is pending approval by Super Admin', 403);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      status: 'success',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          traineeId: user.traineeId
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Admin signup (Organizers)
router.post('/signup/admin', async (req, res, next) => {
  try {
    const { firstName, lastName, email, traineeId, password, confirmPassword } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !traineeId || !password || !confirmPassword) {
      throw new AppError('All fields are required', 400);
    }

    if (password !== confirmPassword) {
      throw new AppError('Passwords do not match', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }

    // Check if email or traineeId already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { traineeId }
        ]
      }
    });

    if (existingUser) {
      throw new AppError('Email or Trainee ID already registered', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin account (pending approval)
    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        traineeId,
        password: hashedPassword,
        role: UserRole.ADMIN,
        approvalStatus: ApprovalStatus.PENDING
      }
    });

    res.status(201).json({
      status: 'success',
      message: 'Admin account created. Waiting for Super Admin approval.',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          traineeId: user.traineeId,
          approvalStatus: user.approvalStatus
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get pending admin approvals (Super Admin only)
router.get('/admin/pending', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const pendingAdmins = await prisma.user.findMany({
      where: {
        role: UserRole.ADMIN,
        approvalStatus: ApprovalStatus.PENDING
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        traineeId: true,
        approvalStatus: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      status: 'success',
      data: { admins: pendingAdmins }
    });
  } catch (error) {
    next(error);
  }
});

// Approve/Reject admin (Super Admin only)
router.put('/admin/:id/approval', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'APPROVED' or 'REJECTED'

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      throw new AppError('Valid approval status required (APPROVED or REJECTED)', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id }
    });

    if (!user) {
      throw new AppError('Admin not found', 404);
    }

    if (user.role !== UserRole.ADMIN) {
      throw new AppError('User is not an admin', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        approvalStatus: status as ApprovalStatus,
        approvedBy: req.user!.userId,
        approvedAt: new Date()
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        traineeId: true,
        approvalStatus: true,
        approvedAt: true
      }
    });

    res.json({
      status: 'success',
      message: `Admin ${status.toLowerCase()} successfully`,
      data: { user: updatedUser }
    });
  } catch (error) {
    next(error);
  }
});

// Get current user info
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        traineeId: true,
        role: true,
        approvalStatus: true,
        playerId: true,
        player: {
          select: {
            id: true,
            fullName: true,
            traineeId: true,
            department: true,
            position: true
          }
        }
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      status: 'success',
      data: { user }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
