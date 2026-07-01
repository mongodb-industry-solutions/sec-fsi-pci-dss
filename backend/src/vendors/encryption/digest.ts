import * as crypto from 'crypto';

// -- Atlas Admin API Basic Auth (over HTTPS) ---------------------------------─

export function buildBasicAuthHeader(publicKey: string, privateKey: string): string {
    const token = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');
    return `Basic ${token}`;
}

export function sha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
}

export function jwtSecret(): string {
    return process.env.PSP_JWT_SECRET ?? 'demo-local-secret-change-in-production';
}