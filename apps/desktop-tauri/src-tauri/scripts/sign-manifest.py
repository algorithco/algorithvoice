#!/usr/bin/env python3
"""Model-manifest signing for Algorith Voice (Ed25519, release-time).

What is signed: the canonical JSON encoding of the manifest's `models`
array ONLY (same bytes as Rust `serde_json::to_vec(&manifest.models)` in
`src/local_asr/manifest.rs::manifest_signing_bytes`). The hex signature is
stored as the top-level `signature` field in `default_manifest.json` and
verified at runtime by `verify_manifest_signature()` (fail closed).

Key generation (do ONCE, on a trusted machine):
    python3 scripts/sign-manifest.py keygen --out <seed-file>

  * Writes the 32-byte seed as one hex line to <seed-file> with
    owner-only permissions (0600 on POSIX, inheritance-stripped ACL
    granting only the current user on Windows).
  * Prints the 32-byte public key as one hex line on stdout. Copy that
    line into `src/local_asr/manifest_signing_pubkey.hex` (that file IS
    committed; the seed file MUST NEVER be committed).
  * Store the seed as the CI secret `MANIFEST_SIGN_KEY_HEX` (or an HSM /
    password manager, matching the project's release process) and delete
    any other copies.

Signing (every time `default_manifest.json` models change, before release):
    python3 scripts/sign-manifest.py sign --key <seed-file> \\
        --manifest ../src/local_asr/default_manifest.json

  * Recomputes the signature over the current models and splices ONLY the
    `signature` value into the file (all other bytes untouched).
  * Afterwards run `cargo test manifest` in `src-tauri/` — the
    `bundled_manifest_verifies_against_baked_pubkey` test is the
    authoritative cross-check that Python canonicalization still matches
    the Rust verifier. If it fails, DO NOT SHIP: fix this script first.

Verification (CI fast gate, no Rust toolchain needed for --check):
    python3 scripts/sign-manifest.py check \\
        --manifest ../src/local_asr/default_manifest.json \\
        --pubkey ../src/local_asr/manifest_signing_pubkey.hex

Requires: PyNaCl (`pip install pynacl`).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys


# Canonical field orders MUST mirror the Rust structs in
# `src/local_asr/manifest.rs` (`#[serde(rename_all = "camelCase")]`):
# serde serializes fields in declaration order, including `None` as null.
MODEL_KEYS = [
    "id", "name", "version", "engine", "quantization", "files", "languages",
    "minRamGb", "recommendedRamGb", "minVramGb", "recommendedVramGb",
    "license", "attribution", "supportedOs", "supportedArch",
]
FILE_KEYS = ["filename", "url", "fallbackUrl", "sha256", "sizeBytes"]


def canonical_models_bytes(models: object) -> bytes:
    # Must match Rust serde_json::to_vec: compact separators, raw UTF-8
    # (no \\u escapes for non-ASCII), declaration-order keys, missing
    # `fallbackUrl` emitted as null. Unknown keys fail loudly so schema
    # drift can never silently change the signed bytes.
    if not isinstance(models, list):
        raise ValueError("manifest models must be a list")
    canon = []
    for m in models:
        if not isinstance(m, dict):
            raise ValueError("model entry must be an object")
        extra = set(m) - set(MODEL_KEYS)
        if extra:
            raise ValueError(f"unknown model keys (update FILE/MODEL_KEYS): {extra}")
        missing = [k for k in MODEL_KEYS if k not in m]
        if missing:
            raise ValueError(f"model {m.get('id')} missing keys: {missing}")
        cm = {k: m[k] for k in MODEL_KEYS}
        files = []
        for f in cm.get("files", []):
            if not isinstance(f, dict):
                raise ValueError("file entry must be an object")
            extra_f = set(f) - set(FILE_KEYS)
            if extra_f:
                raise ValueError(
                    f"unknown file keys (update FILE_KEYS): {extra_f}"
                )
            cf = {k: f.get(k) for k in FILE_KEYS}  # absent -> null, like serde
            files.append(cf)
        cm["files"] = files
        canon.append(cm)
    return json.dumps(canon, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def restrict_owner_only(path: str) -> None:
    if os.name == "posix":
        os.chmod(path, 0o600)
        return
    # Windows: strip inheritance, grant the current user read/write only.
    user = os.environ.get("USERNAME")
    if not user:
        raise RuntimeError("cannot determine USERNAME to restrict key file ACL")
    subprocess.run(
        ["icacls", path, "/inheritance:r", "/grant:r", f"{user}:(R,W)"],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def cmd_keygen(out: str) -> int:
    from nacl.signing import SigningKey

    if os.path.exists(out):
        print(f"refusing to overwrite existing key file: {out}", file=sys.stderr)
        return 1
    seed = bytes(SigningKey.generate())
    with open(out, "w", encoding="ascii") as f:
        f.write(seed.hex() + "\n")
    restrict_owner_only(out)
    pub = bytes(SigningKey(seed).verify_key).hex()
    print(pub)
    print(
        f"seed written to {out} (owner-only). Copied pubkey above into "
        "src/local_asr/manifest_signing_pubkey.hex, then store the seed as "
        "the MANIFEST_SIGN_KEY_HEX CI secret.",
        file=sys.stderr,
    )
    return 0


def load_seed(key_path: str) -> bytes:
    with open(key_path, encoding="ascii") as f:
        seed_hex = f.read().strip().split()[0]
    seed = bytes.fromhex(seed_hex)
    if len(seed) != 32:
        raise ValueError("seed file must contain exactly 32 bytes as hex")
    return seed


def cmd_sign(key_path: str, manifest_path: str) -> int:
    from nacl.signing import SigningKey

    seed = load_seed(key_path)
    with open(manifest_path, encoding="utf-8") as f:
        text = f.read()
    manifest = json.loads(text)
    sig = SigningKey(seed).sign(canonical_models_bytes(manifest["models"])).signature
    new_text, n = re.subn(
        r'"signature"\s*:\s*"[0-9a-fA-F]*"',
        f'"signature": "{sig.hex()}"',
        text,
        count=1,
    )
    if n == 0:
        # No signature field yet: insert before the final closing brace.
        stripped = text.rstrip()
        if not stripped.endswith("}"):
            raise ValueError("manifest does not end with a JSON object")
        body = stripped[:-1].rstrip()
        sep = "," if body.endswith('"') or body.endswith("}") or body.endswith("]") else ""
        # Find indentation of top-level keys from the manifestVersion line.
        m = re.search(r'\n(\s*)"manifestVersion"', text)
        indent = m.group(1) if m else "  "
        new_text = f"{body}{sep}\n{indent}\"signature\": \"{sig.hex()}\"\n}}\n"
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_text)
    print(f"signed {manifest_path} ({len(manifest['models'])} models)")
    print("Now run: cargo test manifest   # authoritative Rust cross-check")
    return 0


def cmd_check(manifest_path: str, pubkey: str) -> int:
    from nacl.signing import VerifyKey
    from nacl.exceptions import BadSignatureError

    pub_hex = pubkey.strip()
    if os.path.exists(pub_hex):
        with open(pub_hex, encoding="ascii") as f:
            pub_hex = f.read().strip()
    if not pub_hex:
        print("FAIL: signing pubkey is empty", file=sys.stderr)
        return 1
    try:
        vk = VerifyKey(bytes.fromhex(pub_hex))
    except Exception as e:
        print(f"FAIL: pubkey malformed: {e}", file=sys.stderr)
        return 1
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    sig_hex = manifest.get("signature", "")
    if not sig_hex:
        print("FAIL: manifest has no signature", file=sys.stderr)
        return 1
    try:
        vk.verify(canonical_models_bytes(manifest["models"]), bytes.fromhex(sig_hex))
    except BadSignatureError:
        print("FAIL: manifest signature INVALID", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print(f"OK: {manifest_path} signature valid ({len(manifest['models'])} models)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_gen = sub.add_parser("keygen", help="generate a new signing keypair")
    p_gen.add_argument("--out", required=True, help="seed output file (never commit)")
    p_sign = sub.add_parser("sign", help="sign a manifest file")
    p_sign.add_argument("--key", required=True, help="seed hex file")
    p_sign.add_argument("--manifest", required=True, help="default_manifest.json path")
    p_check = sub.add_parser("check", help="verify a manifest signature")
    p_check.add_argument("--manifest", required=True)
    p_check.add_argument("--pubkey", required=True, help="hex string or .hex file path")
    args = ap.parse_args()
    if args.cmd == "keygen":
        return cmd_keygen(args.out)
    if args.cmd == "sign":
        return cmd_sign(args.key, args.manifest)
    return cmd_check(args.manifest, args.pubkey)


if __name__ == "__main__":
    raise SystemExit(main())
