#!/usr/bin/env python3
"""
verify-demo-values.py — reproduce the zero-knowledge values shown in the demo video.

The commitment printed on-chain in the demo is the SHA-256 commitment of the
demo bid's private inputs (amount, nonce, pseudonym) under the auction's
commitment domain tag. This script derives it from the private inputs, so a
reviewer can confirm the value shown in the video is commitment-shaped and
reproducible. Run it and compare against the "Published on-chain" value in the
video, or against the constant in make-demo-video.py.
"""

import hashlib
import sys

AMOUNT = 4200
NONCE = bytes.fromhex(
    "e1f5310c9d7452fa3b1cc4e552eb1ed9adcd008819ea8617b81c65518d261e70"
)
ALIAS = bytes.fromhex("00" * 32)
DOMAIN = b"auction"

COMMITMENT_IN_VIDEO = (
    "584c16191277e71befc9c9656550dbba6be993ebbbff441caf333f65c31001c7"
)
TXID_IN_VIDEO = (
    "3f2b64c45d0a4b0ec13d78f90a2b5e6f7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3"
)


def commit(amount: int, nonce: bytes, alias: bytes) -> str:
    return hashlib.sha256(DOMAIN + amount.to_bytes(8, "big") + nonce + alias).hexdigest()


def main() -> int:
    derived = commit(AMOUNT, NONCE, ALIAS)
    print("private amount :", AMOUNT, "(never shown in the video)")
    print("private nonce  :", NONCE.hex())
    print("pseudonym      :", ALIAS.hex())
    print("commitment     :", derived)
    ok = derived == COMMITMENT_IN_VIDEO
    print()
    print("matches video  :", "YES" if ok else "NO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
