import { describe, expect, it } from 'vitest';
import { hideSecrets, SECRET_MARKER, writesHiddenSecret } from '../src/util/secrets';

describe('hideSecrets', () => {
  it('hides provider keys, tokens and private keys', () => {
    const text = [
      'GEMINI=AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvWx',
      'key: gsk_abcdefghijklmnopqrstuvwxyz123456',
      'nvapi-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'aws AKIAIOSFODNN7EXAMPLE',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----',
      'postgres://admin:s3cretPass@db.example.com:5432/app',
    ].join('\n');
    const out = hideSecrets(text);
    expect(out).not.toMatch(/AIzaSy|gsk_abc|nvapi-Ab|ghp_ABC|AKIAIOSF|MIIEpA|s3cretPass/);
    expect(out).toContain('postgres://admin:');
    expect(out.split(SECRET_MARKER).length - 1).toBe(7);
  });

  it('hides literal values of secret-named settings but leaves code and placeholders alone', () => {
    expect(hideSecrets('DB_PASSWORD=hunter2024x\nAPI_KEY="9f8e7d6c5b4a3210"')).toBe(`DB_PASSWORD=${SECRET_MARKER}\nAPI_KEY="${SECRET_MARKER}"`);
    const code = 'const apiKey = process.env.API_KEY;\npassword: form.password,\nSECRET_KEY=your-secret-here\ntoken_count = 42';
    expect(hideSecrets(code)).toBe(code);
  });

  it('refuses writes that would put the marker into a file', () => {
    expect(writesHiddenSecret({ path: '.env', content: `KEY=${SECRET_MARKER}` })).toBe(true);
    expect(writesHiddenSecret({ path: 'a.ts', new_string: 'const x = 1;' })).toBe(false);
  });
});
