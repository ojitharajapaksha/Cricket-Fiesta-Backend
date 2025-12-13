import admin from 'firebase-admin';
import { logger } from './logger';

// Initialize Firebase Admin SDK
// You need to set FIREBASE_SERVICE_ACCOUNT_KEY environment variable
// with the JSON content of your service account key

let firebaseApp: admin.app.App | null = null;
let initializationError: string | null = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    
    if (!serviceAccountKey) {
      initializationError = 'Firebase service account key not found. Set FIREBASE_SERVICE_ACCOUNT_KEY environment variable.';
      logger.warn(initializationError);
      return null;
    }

    const serviceAccount = JSON.parse(serviceAccountKey);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    logger.info('🔥 Firebase Admin SDK initialized successfully');
    return firebaseApp;
  } catch (error: any) {
    initializationError = `Failed to initialize Firebase: ${error.message}`;
    logger.error('Failed to initialize Firebase Admin SDK:', error);
    return null;
  }
};

// Initialize on module load
initializeFirebase();

// Get initialization error for API responses
export const getFirebaseInitError = (): string | null => initializationError;

// Verify Firebase ID token
export const verifyFirebaseToken = async (idToken: string): Promise<admin.auth.DecodedIdToken | null> => {
  try {
    if (!firebaseApp) {
      initializeFirebase();
    }
    
    if (!firebaseApp) {
      logger.error('Firebase not initialized. Error:', initializationError);
      return null;
    }

    const decodedToken = await admin.auth().verifyIdToken(idToken);
    logger.info(`Firebase token verified for email: ${decodedToken.email}`);
    return decodedToken;
  } catch (error: any) {
    logger.error('Firebase token verification failed:', error.message);
    return null;
  }
};

export { firebaseApp };
