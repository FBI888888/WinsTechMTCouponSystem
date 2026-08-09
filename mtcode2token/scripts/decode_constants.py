"""Decode jsguard obfuscated string array to recover Dn (prefix), AES key and IV.

Ports the two obfuscator.io string decoders embedded in wx-jsguard/dist/jsguard.js:
  c(t): XOR-hex decode of n[t], then decodeURIComponent
  a(t): custom-alphabet base64 decode of n[t], then percent -> decodeURIComponent

Then reproduces Z()'s inner key/iv derivation:
  seedKey = xorhex(c(227));  seedIv = xorhex(c(228))   (no salt -> used as-is)
"""
from __future__ import annotations

import json
import re
import urllib.parse
from pathlib import Path

SRC = Path(r"d:/WebstormProjects/txshouyou/mtcode2token/scripts/169.js").read_text(
    encoding="utf-8", errors="replace"
)
OUT = Path(r"d:/WebstormProjects/txshouyou/mtcode2token/notes")

# --- locate the jsguard module and its string array ---
# array literal looks like: "8d5 yMf0DgvYEwLUzM8 ...".split(" ")
# tokens never contain a double-quote, so [^"]+ safely matches the whole array.
m = re.search(r'"([^"]{2000,})"\.split\(" "\),c=function e\(t,c\)', SRC)
assert m, "jsguard array not found"
array_str = m.group(1)
n = array_str.split(" ")
print("array length:", len(n))
print("n[0]=", n[0])


def c_decode(idx: int) -> str:
    e = n[idx]
    key = int(e[0:2], 16)
    out = []
    i = 2
    while i < len(e):
        r = int(e[i : i + 2], 16)
        out.append(chr(r ^ key))
        i += 2
    raw = "".join(out)
    return urllib.parse.unquote(raw)


A_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/="


def a_decode(idx: int) -> str:
    """Faithful port of the base64 decoder `mOkOZr` (custom alphabet), then percent-decode."""
    e = n[idx]
    c = ""
    a = 0
    r = 0
    t = 0
    while r < len(e):
        ch = e[r]
        r += 1
        n_val = A_ALPHABET.find(ch)
        if n_val == -1:  # ~n false -> a/t untouched, nothing appended
            continue
        if a % 4:
            t = 64 * t + n_val
        else:
            t = n_val
        prev = a
        a += 1
        if prev % 4:  # (a++%4) uses the pre-increment value
            c += chr(0xFF & (t >> ((-2 * a) & 6)))
    pct = "".join("%" + ("00" + format(ord(x), "x"))[-2:] for x in c)
    return urllib.parse.unquote(pct)


# sanity: decode index strings used for codec/cipher/prefix to validate the mapping
probe = {}
for label, fn, idx in [
    ("c262_Dn", c_decode, 262),
    ("a229", a_decode, 229),
    ("c227_seedKey", c_decode, 227),
    ("c228_seedIv", c_decode, 228),
    ("c234", c_decode, 234),
    ("a235", a_decode, 235),
    ("c236", c_decode, 236),
    ("c239", c_decode, 239),
    ("c240", c_decode, 240),
    ("c241", c_decode, 241),
    ("a242", a_decode, 242),
    ("a248", a_decode, 248),
    ("a250", a_decode, 250),
    ("a246", a_decode, 246),
]:
    try:
        probe[label] = fn(idx)
    except Exception as ex:  # noqa
        probe[label] = f"ERR {ex}"

for k, v in probe.items():
    print(f"{k!r:20} = {v!r}")


def xorhex(s: str) -> str:
    """Z's inner decode: first byte hex = key, rest hex bytes XOR key -> chars."""
    key = int(s[0:2], 16)
    out = []
    i = 2
    while i < len(s):
        out.append(chr(int(s[i : i + 2], 16) ^ key))
        i += 2
    return "".join(out)


seedKey = c_decode(227)
seedIv = c_decode(228)
print("\nc(227) raw len", len(seedKey), repr(seedKey))
print("c(228) raw len", len(seedIv), repr(seedIv))

key = xorhex(seedKey)
iv = xorhex(seedIv)
print("AES key:", repr(key), "len", len(key))
print("AES iv :", repr(iv), "len", len(iv))

result = {
    "Dn_prefix": probe.get("c262_Dn"),
    "a229": probe.get("a229"),
    "codec_check": {k: probe[k] for k in ("c234", "a235", "c236", "c239", "c240", "c241", "a242", "a248", "a250", "a246")},
    "seedKey_c227": seedKey,
    "seedIv_c228": seedIv,
    "aes_key": key,
    "aes_iv": iv,
    "aes_key_hex": key.encode("latin-1", "backslashreplace").hex() if all(ord(ch) < 256 for ch in key) else None,
    "aes_iv_hex": iv.encode("latin-1", "backslashreplace").hex() if all(ord(ch) < 256 for ch in iv) else None,
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "jsguard_constants.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print("\nsaved", OUT / "jsguard_constants.json")
