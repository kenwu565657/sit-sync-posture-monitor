import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface MobileLoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function MobileLoginScreen({ onLogin }: MobileLoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };
  const runSubmit = () => {
    submit().catch((submitError) => {
      setError(submitError instanceof Error ? submitError.message : 'Login failed');
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <View style={styles.card}>
          <View style={styles.brandRow}>
            <Image
              accessibilityIgnoresInvertColors
              source={require('../assets/sit-sync-logo.png')}
              style={styles.logo}
            />
            <Text style={styles.brand}>SitSync</Text>
          </View>
          <Text style={styles.title}>Mobile sensor gateway</Text>
          <Text style={styles.subtitle}>
            Sign in with the same account used by the web portal.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor="#64748b"
            style={styles.input}
            value={email}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            onChangeText={setPassword}
            onSubmitEditing={runSubmit}
            placeholder="Password"
            placeholderTextColor="#64748b"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            disabled={submitting}
            onPress={runSubmit}
            style={[styles.button, submitting && styles.buttonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color="#082f49" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#020617' },
  center: { flex: 1, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
  },
  brandRow: { alignItems: 'center', flexDirection: 'row' },
  logo: { borderRadius: 14, height: 56, marginRight: 14, width: 56 },
  brand: { color: '#53c979', fontSize: 30, fontWeight: '900' },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#94a3b8', lineHeight: 20, marginBottom: 24, marginTop: 6 },
  input: {
    backgroundColor: '#020617',
    borderColor: '#334155',
    borderRadius: 10,
    borderWidth: 1,
    color: '#f8fafc',
    fontSize: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  error: { color: '#fca5a5', marginBottom: 12 },
  button: {
    alignItems: 'center',
    backgroundColor: '#22d3ee',
    borderRadius: 10,
    marginTop: 4,
    padding: 14,
  },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: '#082f49', fontSize: 16, fontWeight: '900' },
});
