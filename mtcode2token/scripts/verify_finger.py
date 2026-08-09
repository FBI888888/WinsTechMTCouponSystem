"""Verify the local fingerprint algorithm against the live mini-program.

Steps:
  1. Ask the runtime for a real finger.g() output.
  2. Locally decrypt it with the recovered KEY/IV -> must be valid JSON (proves key/iv).
  3. Re-encrypt that exact plaintext locally -> must byte-match the real fingerprint
     (proves cipher/mode/padding/base64/prefix are all correct).
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import websockets

from finger_local import PREFIX, decode_fingerprint, encode_fingerprint

NOTES = Path(__file__).resolve().parents[1] / "notes"

EXPR = r"""
(() => new Promise((resolve) => {
  try {
    Promise.resolve(getApp().finger).then((jg) => {
      jg.finger.g((fp) => resolve(JSON.stringify({fp: String(fp)})));
    }).catch((e) => resolve(JSON.stringify({err: String(e)})));
  } catch (e) { resolve(JSON.stringify({err: String(e)})); }
}))()
"""


async def fetch_real_fp() -> str:
    async with websockets.connect("ws://127.0.0.1:62000", max_size=None, ping_interval=None) as ws:
        rid = 997000000
        pending: dict[int, asyncio.Future] = {}

        async def send(method, params, timeout=60):
            nonlocal rid
            rid += 1
            mid = rid
            fut = asyncio.get_running_loop().create_future()
            pending[mid] = fut
            await ws.send(json.dumps({"id": mid, "method": method, "params": params}))
            return await asyncio.wait_for(fut, timeout)

        async def reader():
            async for raw in ws:
                msg = json.loads(raw)
                if "id" in msg and msg["id"] in pending:
                    fut = pending.pop(msg["id"])
                    if not fut.done():
                        fut.set_result(msg.get("result", {}) if "error" not in msg else {"__error__": msg["error"]})

        t = asyncio.create_task(reader())
        await send("Runtime.enable", {}, 60)
        for ctx in (4, 3, 6, 8, 9, 1, 2, 5, 7):
            try:
                r = await send(
                    "Runtime.evaluate",
                    {"expression": EXPR, "awaitPromise": True, "returnByValue": True, "contextId": ctx},
                    60,
                )
                val = ((r.get("result") or {}).get("value")) or ""
                if not val:
                    continue
                obj = json.loads(val)
                if obj.get("fp", "").startswith(PREFIX):
                    t.cancel()
                    return obj["fp"]
            except Exception:
                continue
        t.cancel()
        raise RuntimeError("could not fetch a real fingerprint")


def main():
    real = asyncio.run(fetch_real_fp())
    print("real fp length:", len(real))
    print("real fp head  :", real[:80], "...")

    plaintext = decode_fingerprint(real)
    print("\n[1] local decrypt OK, plaintext bytes:", len(plaintext))
    try:
        parsed = json.loads(plaintext)
        print("    plaintext IS valid JSON, top-level keys:", list(parsed.keys()))
    except Exception as e:
        parsed = None
        print("    plaintext not JSON:", e, "| head:", plaintext[:120])

    regen = encode_fingerprint(plaintext)  # feed exact plaintext string
    match = regen == real
    print("\n[2] re-encrypt matches real fp EXACTLY:", match)
    if not match:
        # locate first diff
        for i, (x, y) in enumerate(zip(regen, real)):
            if x != y:
                print("    first diff at", i, repr(regen[i:i+20]), "vs", repr(real[i:i+20]))
                break
        print("    regen len", len(regen), "real len", len(real))

    NOTES.mkdir(parents=True, exist_ok=True)
    (NOTES / "finger_verification.json").write_text(
        json.dumps(
            {
                "real_fp": real,
                "plaintext": plaintext,
                "plaintext_is_json": parsed is not None,
                "roundtrip_exact_match": match,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("\nsaved", NOTES / "finger_verification.json")


if __name__ == "__main__":
    main()
