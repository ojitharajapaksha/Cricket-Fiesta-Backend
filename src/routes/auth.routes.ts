import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { UserRole, ApprovalStatus } from '@prisma/client';
import { sendOTPEmail } from '../utils/emailService';
import { verifyFirebaseToken, getFirebaseInitError } from '../utils/firebase';

const router = Router();

// Generate 6-digit OTP
const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Google Sign-In with Firebase
router.post('/google', async (req, res, next) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      throw new AppError('Firebase ID token is required', 400);
    }

    // Check if Firebase is properly configured
    const firebaseError = getFirebaseInitError();
    if (firebaseError) {
      throw new AppError(`Firebase not configured: ${firebaseError}`, 500);
    }

    // Verify Firebase token
    const decodedToken = await verifyFirebaseToken(idToken);
    
    if (!decodedToken) {
      throw new AppError('Invalid or expired token. Please try signing in again.', 401);
    }

    const email = decodedToken.email?.toLowerCase().trim();
    const name = decodedToken.name || decodedToken.email?.split('@')[0] || 'User';
    const picture = decodedToken.picture;

    if (!email) {
      throw new AppError('Email not found in Google account', 400);
    }

    // Check if user exists in any registration table (case-insensitive)
    const player = await prisma.player.findFirst({ 
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { team: true }
    });
    const foodRegistrant = await prisma.foodRegistration.findFirst({ 
      where: { email: { equals: email, mode: 'insensitive' } } 
    });
    const committee = await prisma.committee.findFirst({ 
      where: { email: { equals: email, mode: 'insensitive' } } 
    });

    if (!player && !foodRegistrant && !committee) {
      throw new AppError('No registration found with this email. Please register through Google Form first.', 404);
    }

    // Get user name from registration
    const userName = player?.fullName || foodRegistrant?.fullName || committee?.fullName || name;

    // Determine user type and role
    let userType = 'user';
    let role: UserRole = 'USER';
    let additionalData: any = {};
    let autoApprove = false; // Flag for auto-approval
    let dbUserType: 'PLAYER' | 'TRAINEE' | 'COMMITTEE' = 'PLAYER';

    if (committee) {
      userType = 'committee';
      dbUserType = 'COMMITTEE';
      role = 'ADMIN'; // OC members get ADMIN role
      additionalData.committeeId = committee.id;
      additionalData.assignedTeam = committee.assignedTeam;
      autoApprove = false; // OC members need super admin approval
    } else if (player) {
      userType = 'player';
      dbUserType = 'PLAYER';
      role = 'USER';
      additionalData.playerId = player.id;
      additionalData.team = player.team;
      autoApprove = false; // Players need admin approval
    } else if (foodRegistrant) {
      userType = 'food';
      dbUserType = 'TRAINEE';
      role = 'USER';
      additionalData.foodRegistrationId = foodRegistrant.id;
      autoApprove = true; // Trainees are auto-approved (already in system via bulk import)
    }

    // Check if user exists in User table
    let existingUser = await prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } }
    });

    if (existingUser) {
      // Check approval status
      if (existingUser.approvalStatus === 'REJECTED') {
        throw new AppError('Your login request has been rejected. Please contact the administrator.', 403);
      }
      
      if (existingUser.approvalStatus === 'PENDING') {
        // Return pending status
        return res.status(202).json({
          status: 'pending',
          message: 'Your login request is pending approval. Please wait for admin approval.',
          data: {
            requiresApproval: true,
            email: email,
            name: userName,
          }
        });
      }

      // User is approved - update last login
      const nameParts = userName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { 
          firstName,
          lastName,
        }
      });
    } else {
      // First time login - create user
      const nameParts = userName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Auto-approve if user is registered (player or committee, but NOT trainees)
      const approvalStatus = autoApprove ? 'APPROVED' : 'PENDING';
      
      existingUser = await prisma.user.create({
        data: {
          email: email,
          firstName,
          lastName,
          role: role,
          userType: dbUserType,
          approvalStatus: approvalStatus,
          approvedAt: autoApprove ? new Date() : null,
          traineeId: player?.traineeId || foodRegistrant?.traineeId,
          playerId: additionalData.playerId || null,
        }
      });

      // If not auto-approved, return pending status
      if (!autoApprove) {
        return res.status(202).json({
          status: 'pending',
          message: 'Your first login requires admin approval. Please wait for admin to approve your access.',
          data: {
            requiresApproval: true,
            email: email,
            name: userName,
          }
        });
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: existingUser.id, email: existingUser.email, role: existingUser.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    // Auto check-in for committee members
    if (committee) {
      try {
        await prisma.committee.update({
          where: { id: committee.id },
          data: { 
            checkedIn: true,
            checkInTime: new Date()
          }
        });
      } catch (checkInError) {
        console.error('Auto check-in error:', checkInError);
      }
    }

    res.json({
      status: 'success',
      message: 'Login successful',
      data: {
        token,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: userName,
          firstName: userName.split(' ')[0],
          lastName: userName.split(' ').slice(1).join(' '),
          role: existingUser.role,
          userType,
          traineeId: existingUser.traineeId,
          projectName: existingUser.projectName,
          picture,
          ...additionalData
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Check Firebase status (for debugging)
router.get('/firebase-status', async (req, res) => {
  const error = getFirebaseInitError();
  res.json({
    status: error ? 'error' : 'ok',
    message: error || 'Firebase is properly configured',
    hasServiceAccountKey: !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  });
});

// Request OTP for user login
router.post('/otp/request', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Check if user exists in any of the registration tables (case-insensitive)
    const player = await prisma.player.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const foodRegistrant = await prisma.foodRegistration.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const committee = await prisma.committee.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

    if (!player && !foodRegistrant && !committee) {
      throw new AppError('No registration found with this email. Please register through Google Form first.', 404);
    }

    // Get user name
    const userName = player?.fullName || foodRegistrant?.fullName || committee?.fullName || 'User';
    
    // Normalize email for consistent storage
    const normalizedEmail = email.toLowerCase().trim();

    // Delete any existing OTPs for this email (case-insensitive)
    await prisma.oTP.deleteMany({ 
      where: { 
        email: { equals: normalizedEmail, mode: 'insensitive' } 
      } 
    });

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Save OTP to database
    await prisma.oTP.create({
      data: {
        email: normalizedEmail,
        code: otp,
        type: 'LOGIN',
        expiresAt,
      }
    });

    // Send OTP email
    try {
      await sendOTPEmail({
        to: normalizedEmail,
        name: userName,
        otp,
      });
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError);
      // Still return success since OTP is saved - user can resend
    }

    res.json({
      status: 'success',
      message: 'OTP sent successfully to your email',
      data: {
        email: normalizedEmail,
        expiresIn: 600, // 10 minutes in seconds
      }
    });
  } catch (error) {
    next(error);
  }
});

// Verify OTP and login
router.post('/otp/verify', async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      throw new AppError('Email and OTP are required', 400);
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Find valid OTP (case-insensitive)
    const otpRecord = await prisma.oTP.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        code: otp,
        verified: false,
        expiresAt: { gt: new Date() }
      }
    });

    if (!otpRecord) {
      throw new AppError('Invalid or expired OTP', 401);
    }

    // Mark OTP as verified
    await prisma.oTP.update({
      where: { id: otpRecord.id },
      data: { verified: true }
    });

    // Check if there's an existing approved user (case-insensitive)
    const existingUser = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } }
    });

    if (existingUser) {
      // Check approval status
      if (existingUser.approvalStatus === 'REJECTED') {
        throw new AppError('Your login request has been rejected. Please contact the administrator.', 403);
      }
      
      if (existingUser.approvalStatus === 'PENDING') {
        throw new AppError('Your login request is pending approval. Please wait for admin approval.', 403);
      }

      // User is approved - generate token
      const token = jwt.sign(
        { userId: existingUser.id, email: existingUser.email, role: existingUser.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '30d' }
      );

      // Get additional data (case-insensitive email matching)
      const player = await prisma.player.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      const committee = await prisma.committee.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      const foodRegistrant = await prisma.foodRegistration.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

      let userType = 'user';
      let additionalData: any = {};

      if (player) {
        userType = 'player';
        additionalData.playerId = player.id;
      } else if (committee) {
        userType = 'committee';
        additionalData.committeeId = committee.id;
        additionalData.assignedTeam = committee.assignedTeam;
      } else if (foodRegistrant) {
        userType = 'food';
        additionalData.foodRegistrationId = foodRegistrant.id;
      }

      // Clean up old OTPs
      await prisma.oTP.deleteMany({ where: { email, verified: true } });

      return res.json({
        status: 'success',
        message: 'Login successful',
        data: {
          token,
          user: {
            id: existingUser.id,
            email: existingUser.email,
            name: `${existingUser.firstName} ${existingUser.lastName}`,
            role: existingUser.role,
            userType,
            ...additionalData
          }
        }
      });
    }

    // First-time login - check for existing login request
    const existingRequest = await prisma.userLoginRequest.findFirst({
      where: { email }
    });

    if (existingRequest) {
      if (existingRequest.status === 'REJECTED') {
        throw new AppError('Your login request was rejected. Reason: ' + (existingRequest.reviewNote || 'No reason provided'), 403);
      }
      if (existingRequest.status === 'PENDING') {
        throw new AppError('Your login request is pending approval. Please wait for admin to approve your request.', 403);
      }
      // If approved, this shouldn't happen as user should exist
    }

    // New user - create login request for approval (case-insensitive email matching)
    const player = await prisma.player.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const committee = await prisma.committee.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
    const foodRegistrant = await prisma.foodRegistration.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

    let userType = 'user';
    let fullName = '';
    let traineeId = '';
    let department = '';

    if (player) {
      userType = 'player';
      fullName = player.fullName;
      traineeId = player.traineeId;
      department = player.department;
    } else if (committee) {
      userType = 'committee';
      fullName = committee.fullName;
      traineeId = ''; // Committee members don't have traineeId
      department = committee.department || '';
    } else if (foodRegistrant) {
      userType = 'food';
      fullName = foodRegistrant.fullName;
      traineeId = foodRegistrant.traineeId;
      department = foodRegistrant.department;
    }

    // Create login request
    await prisma.userLoginRequest.create({
      data: {
        email,
        fullName,
        userType,
        traineeId: traineeId || null,
        department: department || null,
        status: 'PENDING',
      }
    });

    // Clean up OTP
    await prisma.oTP.deleteMany({ where: { email, verified: true } });

    // Return pending approval response
    res.status(202).json({
      status: 'pending',
      message: 'Your login request has been submitted and is pending approval from an administrator.',
      data: {
        requiresApproval: true,
        email,
        fullName,
      }
    });
  } catch (error) {
    next(error);
  }
});

// Resend OTP
router.post('/otp/resend', async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check rate limiting - only allow resend after 1 minute (case-insensitive)
    const recentOTP = await prisma.oTP.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        createdAt: { gt: new Date(Date.now() - 60 * 1000) }
      }
    });

    if (recentOTP) {
      throw new AppError('Please wait 1 minute before requesting a new OTP', 429);
    }

    // Check if user exists (case-insensitive)
    const player = await prisma.player.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } });
    const foodRegistrant = await prisma.foodRegistration.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } });
    const committee = await prisma.committee.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } });

    if (!player && !foodRegistrant && !committee) {
      throw new AppError('No registration found with this email', 404);
    }

    const userName = player?.fullName || foodRegistrant?.fullName || committee?.fullName || 'User';

    // Delete old OTPs (case-insensitive)
    await prisma.oTP.deleteMany({ 
      where: { 
        email: { equals: normalizedEmail, mode: 'insensitive' } 
      } 
    });

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.oTP.create({
      data: {
        email: normalizedEmail,
        code: otp,
        type: 'LOGIN',
        expiresAt,
      }
    });

    // Send OTP email
    try {
      await sendOTPEmail({
        to: normalizedEmail,
        name: userName,
        otp,
      });
    } catch (emailError) {
      console.error('Failed to resend OTP email:', emailError);
      // Still return success since OTP is saved
    }

    res.json({
      status: 'success',
      message: 'OTP resent successfully',
      data: {
        email: normalizedEmail,
        expiresIn: 600,
      }
    });
  } catch (error) {
    next(error);
  }
});

// User login (Gmail from Google Form registration - Players or Food Registrants) - LEGACY
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
        role: { in: [UserRole.ADMIN, UserRole.USER] },
        approvalStatus: ApprovalStatus.PENDING
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        traineeId: true,
        role: true,
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

// Get all admins with their status (Super Admin only)
router.get('/admin/all', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.USER] }
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        traineeId: true,
        role: true,
        approvalStatus: true,
        approvedBy: true,
        approvedAt: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      status: 'success',
      data: { admins }
    });
  } catch (error) {
    next(error);
  }
});

// Get approval history (Super Admin only)
router.get('/admin/approval-history', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const history = await prisma.approvalHistory.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            traineeId: true
          }
        },
        performer: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100 // Last 100 actions
    });

    res.json({
      status: 'success',
      data: { history }
    });
  } catch (error) {
    next(error);
  }
});

// Approve/Reject admin or user (Super Admin only)
router.put('/admin/:id/approval', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body; // 'APPROVED' or 'REJECTED'

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
      throw new AppError('Valid approval status required (APPROVED or REJECTED)', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        player: true
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Allow approval for both ADMIN (OC members) and USER (Players)
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.USER) {
      throw new AppError('Cannot modify Super Admin accounts', 400);
    }

    const roleLabel = user.role === UserRole.ADMIN ? 'OC Member' : 'Player';
    const isApproving = status === 'APPROVED';

    // Update user and create history in a transaction
    const [updatedUser] = await prisma.$transaction([
      prisma.user.update({
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
          role: true,
          approvalStatus: true,
          approvedAt: true
        }
      }),
      prisma.approvalHistory.create({
        data: {
          userId: id,
          action: status as ApprovalStatus,
          performedBy: req.user!.userId,
          reason: reason || null
        }
      })
    ]);

    // Also update isApproved on Player or Committee record for public page visibility
    if (user.email) {
      // Update Player isApproved if user is a Player
      if (user.role === UserRole.USER && user.player) {
        await prisma.player.update({
          where: { id: user.player.id },
          data: { isApproved: isApproving }
        });
      }
      
      // Update Committee isApproved if user is an OC member (ADMIN)
      if (user.role === UserRole.ADMIN) {
        const committee = await prisma.committee.findFirst({
          where: { email: { equals: user.email, mode: 'insensitive' } }
        });
        if (committee) {
          await prisma.committee.update({
            where: { id: committee.id },
            data: { isApproved: isApproving }
          });
        }
      }
    }

    res.json({
      status: 'success',
      message: `${roleLabel} ${status.toLowerCase()} successfully`,
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

// ==================== USER LOGIN REQUEST MANAGEMENT ====================

// Get all pending login requests (Super Admin only)
router.get('/login-requests', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { status } = req.query;
    
    const where: any = {};
    if (status && ['PENDING', 'APPROVED', 'REJECTED'].includes(status as string)) {
      where.status = status;
    }

    const requests = await prisma.userLoginRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      status: 'success',
      data: requests
    });
  } catch (error) {
    next(error);
  }
});

// Get pending login requests count
router.get('/login-requests/count', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const count = await prisma.userLoginRequest.count({
      where: { status: 'PENDING' }
    });

    res.json({
      status: 'success',
      data: { count }
    });
  } catch (error) {
    next(error);
  }
});

// Approve login request (Super Admin only)
router.post('/login-requests/:id/approve', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { teamId } = req.body; // Optional team assignment for players
    const adminUser = (req as any).user;

    const loginRequest = await prisma.userLoginRequest.findUnique({
      where: { id }
    });

    if (!loginRequest) {
      throw new AppError('Login request not found', 404);
    }

    if (loginRequest.status !== 'PENDING') {
      throw new AppError('This request has already been processed', 400);
    }

    // Update request status
    await prisma.userLoginRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedBy: adminUser.id,
        reviewedAt: new Date()
      }
    });

    // Create user account based on user type
    const nameParts = loginRequest.fullName.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    let playerId = null;
    if (loginRequest.userType === 'player') {
      const player = await prisma.player.findFirst({
        where: { email: loginRequest.email }
      });
      playerId = player?.id || null;

      // Assign team to player if teamId provided
      if (player && teamId) {
        await prisma.player.update({
          where: { id: player.id },
          data: { teamId }
        });
      }
    }

    // Create the user
    const user = await prisma.user.create({
      data: {
        email: loginRequest.email,
        firstName,
        lastName,
        role: UserRole.USER,
        approvalStatus: ApprovalStatus.APPROVED,
        approvedBy: adminUser.id,
        approvedAt: new Date(),
        traineeId: loginRequest.traineeId,
        playerId,
      }
    });

    // Record in approval history
    await prisma.approvalHistory.create({
      data: {
        userId: user.id,
        action: ApprovalStatus.APPROVED,
        performedBy: adminUser.id,
        reason: teamId ? `First-time login approved with team assignment` : 'First-time login approved'
      }
    });

    // Get team info if assigned
    let teamInfo = null;
    if (teamId) {
      teamInfo = await prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true, color: true }
      });
    }

    res.json({
      status: 'success',
      message: 'Login request approved successfully',
      data: { user, team: teamInfo }
    });
  } catch (error) {
    next(error);
  }
});

// Reject login request (Super Admin only)
router.post('/login-requests/:id/reject', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminUser = (req as any).user;

    const loginRequest = await prisma.userLoginRequest.findUnique({
      where: { id }
    });

    if (!loginRequest) {
      throw new AppError('Login request not found', 404);
    }

    if (loginRequest.status !== 'PENDING') {
      throw new AppError('This request has already been processed', 400);
    }

    // Update request status
    await prisma.userLoginRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedBy: adminUser.id,
        reviewedAt: new Date(),
        reviewNote: reason || 'No reason provided'
      }
    });

    res.json({
      status: 'success',
      message: 'Login request rejected',
      data: { id }
    });
  } catch (error) {
    next(error);
  }
});

// Delete login request (for re-trying) - Super Admin only
router.delete('/login-requests/:id', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;

    const loginRequest = await prisma.userLoginRequest.findUnique({
      where: { id }
    });

    if (!loginRequest) {
      throw new AppError('Login request not found', 404);
    }

    await prisma.userLoginRequest.delete({
      where: { id }
    });

    res.json({
      status: 'success',
      message: 'Login request deleted'
    });
  } catch (error) {
    next(error);
  }
});

// Update user project name
router.put('/profile/project-name', authenticate, async (req, res, next) => {
  try {
    const userId = (req as any).user.userId;
    const { projectName } = req.body;

    if (!projectName || projectName.trim() === '') {
      throw new AppError('Project name is required', 400);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { projectName: projectName.trim() },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        projectName: true,
        role: true,
        userType: true,
        traineeId: true,
      }
    });

    res.json({
      status: 'success',
      message: 'Project name updated successfully',
      data: updatedUser
    });
  } catch (error) {
    next(error);
  }
});

// Get current user profile
router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const userId = (req as any).user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        projectName: true,
        role: true,
        userType: true,
        traineeId: true,
        createdAt: true,
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      status: 'success',
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// Get unique projects from users (for project-wise matches)
router.get('/users/projects', authenticate, async (req, res, next) => {
  try {
    // Get distinct project names from users table
    const users = await prisma.user.findMany({
      where: {
        projectName: {
          not: null,
        },
        approvalStatus: 'APPROVED',
      },
      select: {
        projectName: true,
      },
      distinct: ['projectName'],
    });

    // Extract unique project names and filter out nulls
    const projects = users
      .map(u => u.projectName)
      .filter((p): p is string => p !== null && p.trim() !== '')
      .sort();

    res.json({
      status: 'success',
      data: projects,
      count: projects.length,
    });
  } catch (error) {
    next(error);
  }
});

// Migration endpoint: Link users to players based on traineeId (Super Admin only)
router.post('/migrate/link-users-players', authenticate, requireSuperAdmin, async (req, res, next) => {
  try {
    // Find all users that have a traineeId but no playerId
    const usersWithoutPlayerId = await prisma.user.findMany({
      where: {
        traineeId: { not: null },
        playerId: null,
      },
      select: {
        id: true,
        traineeId: true,
        email: true,
      },
    });

    const updates = [];
    const errors = [];

    // For each user, find the corresponding player and link them
    for (const user of usersWithoutPlayerId) {
      try {
        const player = await prisma.player.findFirst({
          where: {
            OR: [
              { traineeId: user.traineeId! },
              { email: { equals: user.email, mode: 'insensitive' } },
            ],
          },
        });

        if (player) {
          await prisma.user.update({
            where: { id: user.id },
            data: { playerId: player.id },
          });
          updates.push({ userId: user.id, playerId: player.id, traineeId: user.traineeId });
        } else {
          errors.push({ userId: user.id, traineeId: user.traineeId, error: 'No matching player found' });
        }
      } catch (error: any) {
        errors.push({ userId: user.id, traineeId: user.traineeId, error: error.message });
      }
    }

    res.json({
      status: 'success',
      message: `Migration completed. ${updates.length} users linked to players.`,
      data: {
        updated: updates,
        errors: errors,
        summary: {
          totalProcessed: usersWithoutPlayerId.length,
          successfulUpdates: updates.length,
          failedUpdates: errors.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
