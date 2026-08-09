import hashlib
import hmac


def verify_password(plain: str, stored: str) -> bool:
    """Verify a plaintext password against the media server's stored hash.

    Note(yoochan.kim): mirrors server/auth/password.ts. Stored format is
    `scrypt$N$r$p$saltHex$keyHex` (Node crypto.scryptSync) — standard scrypt, so
    a single hash string is shared by both services.

    Note(yoochan.kim): hashlib rather than the cryptography package. Scrypt has
    been in the standard library since 3.6, and the package it replaces is a
    Rust extension whose wheels want a newer libffi than the Pi this runs on.
    One dependency fewer, and one that could not have been installed there.
    """
    try:
        scheme, n_str, r_str, p_str, salt_hex, key_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False

    try:
        n, r, p = int(n_str), int(r_str), int(p_str)
        salt = bytes.fromhex(salt_hex)
        key = bytes.fromhex(key_hex)
    except ValueError:
        return False

    # OpenSSL refuses to allocate past maxmem, and scrypt needs 128*N*r bytes.
    derived = hashlib.scrypt(
        plain.encode("utf-8"),
        salt=salt,
        n=n,
        r=r,
        p=p,
        dklen=len(key),
        maxmem=128 * n * r * (p + 2),
    )
    return hmac.compare_digest(derived, key)
