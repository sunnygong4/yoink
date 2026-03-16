import { createContext, useContext, useEffect, useState } from 'react';
import { getMe } from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const initAuth = async () => {
      if (!token) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        const userData = await getMe();
        if (active) {
          setUser(userData);
        }
      } catch (error) {
        console.error('Failed to fetch user', error);
        if (active) {
          setToken(null);
          localStorage.removeItem('token');
          setUser(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    initAuth();
    return () => {
      active = false;
    };
  }, [token]);

  const login = (newToken) => {
    setToken(newToken);
    localStorage.setItem('token', newToken);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
