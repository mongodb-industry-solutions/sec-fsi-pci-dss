import * as crypto from 'crypto';

// -- HTTP Digest Auth (RFC 7616 MD5) ----------------------------------------─

export function md5(s: string): string {
    return crypto.createHash('md5').update(s).digest('hex');
}

export function buildDigestHeader(
    publicKey: string,
    privateKey: string,
    method: string,
    path: string,
    realm: string,
    nonce: string,
    opaque?: string,
): string {
    const ha1 = md5(`${publicKey}:${realm}:${privateKey}`);
    const ha2 = md5(`${method}:${path}`);
    const cnonce = crypto.randomBytes(8).toString('hex');
    const nc = '00000001';
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    const parts = [
        `Digest username="${publicKey}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${path}"`,
        `cnonce="${cnonce}"`,
        `nc=${nc}`,
        `qop=auth`,
        `response="${response}"`,
    ];
    if (opaque) parts.push(`opaque="${opaque}"`);
    return parts.join(', ');
}


export interface DigestChallenge {
    realm: string;
    nonce: string;
    opaque?: string;
}

export function parseWwwAuthenticate(header: string): DigestChallenge {
    const extract = (key: string) => header.match(new RegExp(`${key}="([^"]+)"`))?.[1] ?? '';
    return {
        realm: extract('realm'),
        nonce: extract('nonce'),
        opaque: header.match(/opaque="([^"]+)"/)?.[1]
    };
}