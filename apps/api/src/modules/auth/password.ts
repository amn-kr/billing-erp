import { hash } from '@node-rs/argon2';

/** argon2id with OWASP-recommended settings. */
export const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string): Promise<string> => hash(pw, ARGON);
