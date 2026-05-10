import sys

import requests


def main() -> int:
    health = requests.get("http://localhost:8000/health", timeout=5)
    if health.status_code != 200:
        print("health failed:", health.status_code, health.text)
        return 1

    missing = requests.get(
        "http://localhost:8000/api/profile/not-a-session?rows=1", timeout=10
    )
    if missing.status_code != 404:
        print("expected 404 for missing session:", missing.status_code, missing.text)
        return 1

    print("smoke ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

