from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt


def verify_password(plain: str, stored: str) -> bool:
    """Verify a plaintext password against the media server's stored hash.

    Note(yoochan.kim): mirrors server/auth/password.ts. Stored format is
    `scrypt$N$r$p$saltHex$keyHex` (Node crypto.scryptSync) — standard scrypt, so
    a single hash string is shared by both services. Uses the cryptography
    library's KDF for a portable backend (Node/OpenSSL <-> macOS LibreSSL).
    """
    try:
        scheme, n_str, r_str, p_str, salt_hex, key_hex = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False

    salt = bytes.fromhex(salt_hex)
    key = bytes.fromhex(key_hex)
    kdf = Scrypt(salt=salt, length=len(key), n=int(n_str), r=int(r_str), p=int(p_str))
    try:
        kdf.verify(plain.encode("utf-8"), key)
        return True
    except InvalidKey:
        return False
