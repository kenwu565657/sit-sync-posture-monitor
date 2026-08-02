import React, { lazy, Suspense } from 'react';
import {
    HashRouter as Router,
    Routes,
    Route,
    Link,
    useLocation,
    Navigate,
    useNavigate,
    Outlet,
} from 'react-router-dom';
import { clearWebSession, getWebToken, getWebUser } from './auth/webSession';
import ProductPage from './page/ProductPage';

const StreamPage = lazy(() => import('./page/StreamPage'));
const DashboardPage = lazy(() => import('./page/DashboardPage'));
const SettingPage = lazy(() => import('./page/SettingPage'));
const PostureReportPage = lazy(() => import('./page/ClinicianReportPage'));
const CalendarPage = lazy(() => import('./page/CalendarPage'));
const LoginPage = lazy(() => import('./page/LoginPage'));

function ProtectedLayout() {
    const token = getWebToken();

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div style={styles.appContainer}>
            <NavBar />
            <main style={styles.pageContent}>
                <Outlet />
            </main>
        </div>
    );
}

function NavBar() {
    const location = useLocation();
    const navigate = useNavigate();
    const user = getWebUser();

    const logout = () => {
        clearWebSession();
        navigate('/login', { replace: true });
    };

    return (
        <nav style={styles.navbar}>
            <Link to="/" style={styles.logo}>
                <img src="/sit-sync-logo.png" alt="" style={styles.logoImage} />
                <span>Sit-Sync Web Portal</span>
            </Link>
            <div style={styles.navArea}>
                <div style={styles.navLinks}>

                    <Link
                        to="/app"
                        style={{ ...styles.link, ...(location.pathname === '/app' ? styles.activeLink : {}) }}
                    >
                        🔴 Live Monitor
                    </Link>
                    <Link
                        to="/dashboard"
                        style={{ ...styles.link, ...(location.pathname === '/dashboard' ? styles.activeLink : {}) }}
                    >
                        📊 Analytics
                    </Link>
                    <Link
                        to="/settings"
                        style={{ ...styles.link, ...(location.pathname === '/settings' ? styles.activeLink : {}) }}
                    >
                        ⚙️ Settings
                    </Link>
                    <Link
                        to="/report"
                        style={{ ...styles.link, ...(location.pathname === '/report' ? styles.activeLink : {}) }}
                    >
                        📝 Posture Report
                    </Link>
                    <Link
                        to="/calendar"
                        style={{ ...styles.link, ...(location.pathname === '/calendar' ? styles.activeLink : {}) }}
                    >
                        📅 History
                    </Link>
                </div>
                <div style={styles.userArea}>
                    <div style={styles.userText}>
                        <strong style={styles.userName}>{user?.name ?? 'Signed in'}</strong>
                        {user?.email && <span style={styles.userEmail}>{user.email}</span>}
                    </div>
                    <button type="button" onClick={logout} style={styles.logoutButton}>
                        Log out
                    </button>
                </div>
            </div>
        </nav>
    );
}

function PortalLoading() {
    return (
        <div style={styles.loading}>
            <span>Loading Sit-Sync…</span>
        </div>
    );
}

export default function App() {
    return (
        <Router>
            <Suspense fallback={<PortalLoading />}>
                    <Routes>
                        <Route path="/" element={<ProductPage />} />
                        <Route path="/login" element={<LoginPage />} />
                        <Route element={<ProtectedLayout />}>
                            <Route path="/app" element={<StreamPage />} />
                            <Route path="/dashboard" element={<DashboardPage />} />
                            <Route path="/settings" element={<SettingPage />} />
                            <Route path="/report" element={<PostureReportPage />} />
                            <Route path="/calendar" element={<CalendarPage />} />
                        </Route>
                        <Route
                            path="/weekly-recap"
                            element={<Navigate to="/report" replace />}
                        />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
            </Suspense>
        </Router>
    );
}

const styles: { [key: string]: React.CSSProperties } = {
    appContainer: { minHeight: '100vh', backgroundColor: '#0f172a', fontFamily: 'sans-serif' },
    navbar: { display: 'flex', justifyContent: 'space-between', gap: '24px', padding: '15px 30px', backgroundColor: '#1e293b', borderBottom: '1px solid #334155', alignItems: 'center', flexWrap: 'wrap' },
    logo: { display: 'flex', alignItems: 'center', gap: '10px', color: 'white', fontSize: '20px', fontWeight: 'bold', textDecoration: 'none' },
    logoImage: { width: '38px', height: '38px', borderRadius: '10px', objectFit: 'cover' },
    navArea: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '20px', flex: 1, flexWrap: 'wrap' },
    navLinks: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' },
    link: { color: '#94a3b8', textDecoration: 'none', fontSize: '16px', padding: '8px 12px', borderRadius: '6px', transition: 'all 0.2s' },
    activeLink: { backgroundColor: '#38bdf8', color: '#0f172a', fontWeight: 'bold' },
    userArea: { display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '20px', borderLeft: '1px solid #475569' },
    userText: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: '100px' },
    userName: { color: '#f8fafc', fontSize: '14px' },
    userEmail: { color: '#94a3b8', fontSize: '12px' },
    logoutButton: { backgroundColor: '#7f1d1d', color: '#fecaca', border: '1px solid #b91c1c', padding: '8px 12px', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' },
    pageContent: { boxSizing: 'border-box', width: '100%', padding: '20px', overflowX: 'hidden' },
    loading: { display: 'grid', minHeight: '100vh', placeItems: 'center', color: '#cbd5e1', backgroundColor: '#07111f', fontFamily: 'sans-serif' },
};