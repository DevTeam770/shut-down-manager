import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';

// code-splitting פר-דף — טעינה ראשונית מהירה
const Login = lazy(() => import('./pages/Login.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Shutdowns = lazy(() => import('./pages/Shutdowns.jsx'));
const ShutdownDetail = lazy(() => import('./pages/ShutdownDetail.jsx'));
const Groups = lazy(() => import('./pages/Groups.jsx'));
const GroupDetail = lazy(() => import('./pages/GroupDetail.jsx'));
const CalendarPage = lazy(() => import('./pages/CalendarPage.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

function Loading() {
  return (
    <div style={{ padding: 40 }}>
      <div className="skeleton" style={{ height: 32, width: 240, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 120 }} />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        {user ? (
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/shutdowns" element={<Shutdowns />} />
            <Route path="/shutdowns/:id" element={<ShutdownDetail />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/:id" element={<GroupDetail />} />
            <Route path="/calendar" element={<CalendarPage />} />
            {user.role === 'admin' && <Route path="/admin" element={<Admin />} />}
            <Route path="*" element={<Navigate to="/" />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Routes>
    </Suspense>
  );
}
