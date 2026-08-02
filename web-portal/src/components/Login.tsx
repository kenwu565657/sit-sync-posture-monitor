import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveWebSession } from '../auth/webSession';
import { apiUrl } from '../config/env';

interface LoginResponse {
    token?: string;
    user?: {
        id?: string;
        name?: string;
    };
    error?: string;
}

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // React Router hook to redirect the user after they log in
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault(); // Prevent the page from refreshing
        setError('');
        setIsLoading(true);

        try {
            // Send credentials to the Node.js auth route
            const response = await fetch(apiUrl('/api/auth/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json() as LoginResponse;

            if (!response.ok) {
                throw new Error(data.error || 'Failed to login');
            }
            if (
                !data.token ||
                typeof data.user?.id !== 'string' ||
                typeof data.user.name !== 'string'
            ) {
                throw new Error('Login response did not include a valid session');
            }

            saveWebSession(data.token, {
                id: data.user.id,
                name: data.user.name,
                email: email.trim(),
            });
            
            // Redirect the user into the main app
            navigate('/dashboard');

        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to login');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={styles.pageContainer}>
            <div style={styles.loginCard}>
                <div style={styles.logo}>
                    <img src="/sit-sync-logo.png" alt="" style={styles.logoImage} />
                    <span>Sit-Sync</span>
                </div>
                <h2 style={styles.header}>Welcome Back</h2>
                <p style={styles.subtitle}>Log in to view your ergonomic analytics.</p>

                {error && <div style={styles.errorBox}>⚠️ {error}</div>}

                <form onSubmit={handleLogin} style={styles.form}>
                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Email Address</label>
                        <input 
                            type="email" 
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            style={styles.input}
                            placeholder="alex@example.com"
                        />
                    </div>

                    <div style={styles.inputGroup}>
                        <label style={styles.label}>Password</label>
                        <input 
                            type="password" 
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={styles.input}
                            placeholder="••••••••"
                        />
                    </div>

                    <button 
                        type="submit" 
                        disabled={isLoading}
                        style={{...styles.submitButton, opacity: isLoading ? 0.7 : 1}}
                    >
                        {isLoading ? 'Authenticating...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}

const styles: { [key: string]: React.CSSProperties } = {
    pageContainer: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', fontFamily: 'sans-serif' },
    loginCard: { backgroundColor: '#1e293b', padding: '40px', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' },
    logo: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', color: '#53c979', fontSize: '24px', fontWeight: 'bold', textAlign: 'center', marginBottom: '14px' },
    logoImage: { width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover' },
    header: { color: 'white', fontSize: '28px', margin: '0 0 10px 0', textAlign: 'center' },
    subtitle: { color: '#94a3b8', textAlign: 'center', marginBottom: '30px', fontSize: '14px' },
    errorBox: { backgroundColor: '#7f1d1d', color: '#fca5a5', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '14px', textAlign: 'center' },
    form: { display: 'flex', flexDirection: 'column', gap: '20px' },
    inputGroup: { display: 'flex', flexDirection: 'column', gap: '8px' },
    label: { color: '#cbd5e1', fontSize: '14px', fontWeight: 'bold' },
    input: { padding: '12px', borderRadius: '8px', border: '1px solid #334155', backgroundColor: '#0f172a', color: 'white', fontSize: '16px', outline: 'none' },
    submitButton: { backgroundColor: '#38bdf8', color: '#0f172a', border: 'none', padding: '14px', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', transition: 'background-color 0.2s', marginTop: '10px' }
};