"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import type { User as FirebaseUser } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { errorMessage } from "@/lib/orders";
import {
  createLocalAccount,
  getLocalAccount,
  LocalAuthError,
  signInLocalAccount,
  signOutLocalAccount,
  type LocalAccount,
} from "@/lib/localAuth";

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  authProvider: "firebase" | "password";
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function fromFirebase(user: FirebaseUser): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    authProvider: "firebase",
  };
}

function fromLocalAccount(account: LocalAccount): AuthUser {
  return {
    uid: `account:${account.id}`,
    email: account.email,
    displayName: account.name,
    photoURL: null,
    authProvider: "password",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<AuthUser | null>(null);
  const [localUser, setLocalUser] = useState<AuthUser | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const user = firebaseUser ?? localUser;
  const loading = !(firebaseReady && localReady);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseAccount) => {
        if (!active) return;
        setFirebaseUser(firebaseAccount ? fromFirebase(firebaseAccount) : null);
        setFirebaseReady(true);
      },
      () => {
        if (!active) return;
        setFirebaseUser(null);
        setFirebaseReady(true);
      },
    );
    void getLocalAccount().then((account) => {
      if (!active) return;
      setLocalUser(account ? fromLocalAccount(account) : null);
      setLocalReady(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setLocalUser(null);
      // Redirect to home is handled by the sign-in page
    } catch (error: unknown) {
      console.error("Google sign-in error:", errorMessage(error));
      throw error;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const account = await signInLocalAccount(email, password);
      if (auth.currentUser) {
        await firebaseSignOut(auth).catch(() => undefined);
      }
      setFirebaseUser(null);
      setLocalUser(fromLocalAccount(account));
      setLocalReady(true);
      return;
    } catch (error: unknown) {
      const code = error instanceof LocalAuthError ? error.code : "";
      if (
        code !== "INVALID_CREDENTIALS" &&
        code !== "AUTH_SERVICE_UNAVAILABLE" &&
        code !== "AUTH_STORAGE_UNAVAILABLE"
      ) {
        throw error;
      }
    }

    // Existing Firebase email/password accounts remain usable. Newly created
    // email accounts use the local API, so Firebase can be unavailable.
    const credential = await signInWithEmailAndPassword(auth, email, password);
    setFirebaseUser(fromFirebase(credential.user));
    setLocalUser(null);
  };

  const signUpWithEmail = async (name: string, email: string, password: string) => {
    const account = await createLocalAccount(name, email, password);
    if (auth.currentUser) {
      await firebaseSignOut(auth).catch(() => undefined);
    }
    setFirebaseUser(null);
    setLocalUser(fromLocalAccount(account));
    setFirebaseReady(true);
    setLocalReady(true);
  };

  const signOut = async () => {
    const failures: unknown[] = [];
    try {
      await firebaseSignOut(auth);
    } catch (error: unknown) {
      failures.push(error);
    }
    try {
      await signOutLocalAccount();
    } catch (error: unknown) {
      failures.push(error);
    }
    setFirebaseUser(null);
    setLocalUser(null);
    if (failures.length) console.error("Sign-out error:", errorMessage(failures[0]));
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
