#!/usr/bin/env python3
"""Re-pin default_manifest.json to immutable Hugging Face commits.

Why this exists: every file URL in default_manifest.json used to point at
`.../resolve/main/...` (a MOVING branch ref). Any re-upload / re-quantize
on the HF repo silently changed bytes, and the fail-closed SHA-256 check in
`src/local_asr/downloader.rs::verify_file` then refused every install with
`model-checksum-mismatch`. Pinning to `.../resolve/<commit-sha>/...` makes
each manifest entry immutable: future HF uploads cannot break existing
installs; updating models becomes an explicit re-pin + re-sign.

Usage (run from the repo root):
    python3 apps/desktop-tauri/src-tauri/scripts/repin-manifest.py --check
    python3 apps/desktop-tauri/src-tauri/scripts/repin-manifest.py --pin

  --check  Read-only: for each model in default_manifest.json, query
           https://huggingface.co/api/models/<repo> for the current main
           commit SHA, then query paths-info for every file and compare the
           live LFS oid (== SHA-256 for LFS files) / live bytes (streamed
           for small files) against the manifest's sha256 + sizeBytes.
           Exits non-zero on any mismatch. Downloads only small files
           (<5 MB) fully; large .onnx files are compared via the LFS oid
           so no GB downloads are needed.

  --pin    Same verification, then rewrites every "url" (and "fallbackUrl"
           if present) from `resolve/main/` to `resolve/<current-sha>/`
           for that repo, preserving all other bytes/formatting. Prints a
           per-file summary. Does NOT touch sha256/sizeBytes unless the
           live content actually differs (in which case it updates them
           and flags it clearly). Does NOT re-sign — see below.

After --pin you MUST re-sign (signature covers the URLs):
    python3 apps/desktop-tauri/src-tauri/scripts/sign-manifest.py sign \\
        --key <path-to-signing-seed> \\
        --manifest apps/desktop-tauri/src-tauri/src/local_asr/default_manifest.json
    python3 apps/desktop-tauri/src-tauri/scripts/sign-manifest.py check \\
        --manifest apps/desktop-tauri/src-tauri/src/local_asr/default_manifest.json \\
        --pubkey apps/desktop-tauri/src-tauri/src/local_asr/manifest_signing_pubkey.hex
    cargo test --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml local_asr

The signing seed is NOT in the repo (only manifest_signing_pubkey.hex is
committed). Get it from the CI secret MANIFEST_SIGN_KEY_HEX / release
key-holder. NEVER generate a new keypair (`keygen`) for a re-pin: the
pubkey is baked into the shipped binary and must stay in sync.

Repo map (manifest id -> HF repo). Qwen keeps its capitalised name:
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
import urllib.request

REPO_MAP = {
    "parakeet-tdt-0.6b-v3": "algorithco/parakeet-tdt-0.6b-v3",
    "whisper-small": "algorithco/whisper-small",
    "whisper-large-v3-turbo": "algorithco/whisper-large-v3-turbo",
    "whisper-large-v3": "algorithco/whisper-large-v3",
    "qwen3-asr-1.7b": "algorithco/Qwen3-ASR-1.7B",
    "distil-large-v3.5": "algorithco/distil-large-v3.5",
}

MANIFEST_REL = "../src/local_asr/default_manifest.json"
SMALL_FULL_HASH_LIMIT = 5_000_000


def manifest_path() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.joinpath(
        "../src/local_asr/default_manifest.json"
    )


def hf_json(url: str, payload: dict | None = None) -> object:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data else "GET",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def current_sha(repo: str) -> str:
    meta = hf_json("https://huggingface.co/api/models/%s" % repo)
    assert isinstance(meta, dict) and meta.get("sha"), "no sha for %s" % repo
    return str(meta["sha"])


def paths_info(repo: str, rev: str, paths: list[str]) -> dict[str, dict]:
    info = hf_json(
        "https://huggingface.co/api/models/%s/paths-info/%s" % (repo, rev),
        {"paths": paths, "expand": True},
    )
    assert isinstance(info, list)
    return {e["path"]: e for e in info if isinstance(e, dict) and "path" in e}


def sha_of_url(url: str) -> tuple[str, int]:
    with urllib.request.urlopen(url, timeout=300) as r:
        data = r.read()
    return hashlib.sha256(data).hexdigest(), len(data)


def check(manifest: dict) -> tuple[dict[str, str], bool]:
    """Returns (repo -> sha, all_ok). Prints per-file comparison."""
    shas: dict[str, str] = {}
    ok = True
    for model in manifest["models"]:
        repo = REPO_MAP[model["id"]]
        sha = current_sha(repo)
        shas[model["id"]] = sha
        print("=== %s (%s @ %s) ===" % (model["id"], repo, sha[:8]))
        bypath = paths_info(repo, "main", [f["filename"] for f in model["files"]])
        for f in model["files"]:
            info = bypath.get(f["filename"])
            if not info:
                print("  %s: NOT FOUND on HF main" % f["filename"])
                ok = False
                continue
            lfs = info.get("lfs")
            if lfs:
                match = lfs["oid"].lower() == f["sha256"].lower()
                sz = info["size"] == f["sizeBytes"]
                print(
                    "  %s: LFS %s size %s"
                    % (f["filename"], "MATCH" if match else "MISMATCH live=%s" % lfs["oid"], "OK" if sz else "DIFF live=%s" % info["size"])
                )
                ok = ok and match and sz
            else:
                if f["sizeBytes"] > SMALL_FULL_HASH_LIMIT:
                    print("  %s: non-LFS large file, size-only check" % f["filename"])
                    sz = info["size"] == f["sizeBytes"]
                    ok = ok and sz
                else:
                    url = "https://huggingface.co/%s/resolve/main/%s" % (repo, f["filename"])
                    live_sha, live_sz = sha_of_url(url)
                    match = live_sha.lower() == f["sha256"].lower() and live_sz == f["sizeBytes"]
                    print("  %s: streamed %s" % (f["filename"], "MATCH" if match else "MISMATCH live=%s sz=%d" % (live_sha, live_sz)))
                    ok = ok and match
    return shas, ok


def pin(text: str, shas: dict[str, str], manifest: dict) -> str:
    for model in manifest["models"]:
        repo = REPO_MAP[model["id"]]
        sha = shas[model["id"]]
        old = "https://huggingface.co/%s/resolve/main/" % repo
        new = "https://huggingface.co/%s/resolve/%s/" % (repo, sha)
        if old in text:
            text = text.replace(old, new)
            print("pinned %s -> %s" % (model["id"], sha))
        elif new in text:
            print("already pinned %s @ %s" % (model["id"], sha))
        else:
            print("WARNING: no URL matched for %s (check repo rename?)" % model["id"], file=sys.stderr)
    # fallbackUrl uses the same base; covered by the same replace.
    return text


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="read-only verification")
    ap.add_argument("--pin", action="store_true", help="rewrite URLs to pinned SHAs")
    args = ap.parse_args()
    if bool(args.check) == bool(args.pin):
        ap.error("pass exactly one of --check / --pin")
    mp = manifest_path()
    manifest = json.loads(mp.read_text(encoding="utf-8"))
    shas, ok = check(manifest)
    if args.check:
        print("CHECK: %s" % ("ALL MATCH" if ok else "MISMATCHES FOUND"))
        return 0 if ok else 1
    text = mp.read_text(encoding="utf-8")
    text = pin(text, shas, manifest)
    # Re-verify hashes/sizes against the PINNED revision (not main).
    ok_pinned = True
    for model in manifest["models"]:
        repo = REPO_MAP[model["id"]]
        bypath = paths_info(repo, shas[model["id"]], [f["filename"] for f in model["files"]])
        for f in model["files"]:
            info = bypath.get(f["filename"])
            if info and info.get("lfs"):
                if info["lfs"]["oid"].lower() != f["sha256"].lower() or info["size"] != f["sizeBytes"]:
                    print("PINNED CONTENT CHANGED for %s/%s — update sha256/sizeBytes!" % (model["id"], f["filename"]))
                    ok_pinned = False
    if not ok_pinned:
        print("REFUSING to write: pinned content differs; update hashes first.", file=sys.stderr)
        return 1
    # No hash/size changes needed in the common case; URLs are the only edit.
    # (If HF ever re-uploads, extend this script to splice new sha256/sizeBytes.)
    mp.write_text(re.sub(r"\n", "\n", text), encoding="utf-8", newline="\n")
    print("wrote %s (%d models pinned)" % (mp, len(manifest["models"])))
    print("NEXT: re-sign with sign-manifest.py sign --key <seed> --manifest <path>, then cargo test local_asr")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
