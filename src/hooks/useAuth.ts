import { useState, useEffect } from 'react';
import { 
  auth, 
  signInWithGoogle, 
  logout as firebaseLogout, 
  onAuthStateChanged, 
  User 
} from '../firebase';

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (error: any) {
      const errorCode = error.code || "";
      const errorMessage = error.message || "";
      
      if (errorCode === 'auth/cancelled-popup-request' || errorCode === 'auth/popup-closed-by-user') {
        return;
      }

      let message = "Error al iniciar sesión. Por favor, intenta de nuevo.";
      const currentDomain = window.location.hostname;

      if (errorCode === 'auth/popup-blocked') {
        message = "El navegador bloqueó la ventana emergente. Por favor, permite las ventanas emergentes para este sitio.";
      } else if (errorCode === 'auth/unauthorized-domain' || errorMessage.includes('auth/unauthorized-domain')) {
        message = `Este dominio (${currentDomain}) no está autorizado en la consola de Firebase. Por favor, agrégalo a la lista de dominios autorizados en la configuración de Firebase Auth.`;
      } else if (errorCode === 'auth/network-request-failed') {
        message = "Error de red. Por favor, verifica tu conexión a internet.";
      } else if (errorCode === 'auth/internal-error') {
        message = "Error interno de Firebase. Por favor, intenta de nuevo más tarde.";
      } else {
        message = `Error técnico (${errorCode || 'unknown'}): ${errorMessage}`;
      }
      
      setAuthError(message);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = async () => {
    try {
      await firebaseLogout();
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  return { user, isAuthReady, authError, isLoggingIn, login, logout, setAuthError };
};
