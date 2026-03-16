import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Dashboard from './Dashboard';
import LoginPage from './LoginPage';
import SharedPlaylistPage from './SharedPlaylistPage';

const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-950 text-stone-100 grid place-items-center">
        <p className="text-sm uppercase tracking-[0.3em] text-amber-200/70">Loading Yoinker</p>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/shared/:shareToken" element={<SharedPlaylistPage />} />
      <Route
        path="/"
        element={(
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        )}
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
