"""Install the tested FIFO plugin into the dedicated Favorite Hermes profile.

Run with the Python interpreter used by that profile's gateway. --check only
verifies a disposable profile; installation does not restart any service.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import yaml

PLUGIN = "favorite-message-context"
FILES = ("__init__.py", "serial_queue.py", "plugin.yaml")
SOURCE = Path(__file__).resolve().parents[1] / "integrations" / "hermes" / PLUGIN


def atomic_write(path: Path, data: bytes) -> None:
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def preflight(settings: dict) -> None:
    with tempfile.TemporaryDirectory(prefix="favorite-queue-check-") as root:
        home = Path(root)
        target = home / "plugins" / PLUGIN
        target.mkdir(parents=True)
        for name in FILES:
            shutil.copyfile(SOURCE / name, target / name)
        config = {"plugins": {"enabled": [PLUGIN], "entries": {PLUGIN: {"settings": settings}}}}
        (home / "config.yaml").write_text(yaml.safe_dump(config))
        code = """
from hermes_cli.plugins import get_plugin_manager
from gateway.platform_registry import platform_registry
from gateway.config import PlatformConfig
manager = get_plugin_manager()
manager.discover_and_load()
entry = platform_registry.get('discord')
adapter = entry.adapter_factory(PlatformConfig())
assert type(adapter).__name__ == 'FavoriteDiscordAdapter'
assert entry.allowed_users_env == 'DISCORD_ALLOWED_USERS'
assert entry.allow_all_env == 'DISCORD_ALLOW_ALL_USERS'
assert callable(entry.apply_yaml_config_fn)
assert adapter._favorite_capacity == EXPECTED_CAPACITY
assert sorted(adapter._favorite_channels) == EXPECTED_CHANNELS
print('PASS: isolated Hermes plugin registration, FIFO, and Discord auth bridge')
""".replace("EXPECTED_CAPACITY", repr(settings["queue_capacity"])).replace(
            "EXPECTED_CHANNELS", repr(sorted(settings["queue_channels"]))
        )
        subprocess.run(
            [sys.executable, "-c", code], check=True,
            env={**os.environ, "HERMES_HOME": root, "PYTHONDONTWRITEBYTECODE": "1"},
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile-home", type=Path, required=True)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--capacity", type=int, default=32)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    home = args.profile_home.resolve()
    if home.name != "favorite":
        parser.error("Use the dedicated favorite profile home")
    if not args.channel.isascii() or not args.channel.isdigit() or not 17 <= len(args.channel) <= 20:
        parser.error("--channel must be a Discord snowflake")
    if not 1 <= args.capacity <= 100:
        parser.error("--capacity must be between 1 and 100")
    path = home / "config.yaml"
    original = path.read_bytes()
    config = yaml.safe_load(original)
    entries = config.setdefault("plugins", {}).setdefault("entries", {})
    settings = entries.setdefault(PLUGIN, {}).setdefault("settings", {})
    settings.update(queue_channels=[args.channel], queue_capacity=args.capacity)
    enabled = config["plugins"].setdefault("enabled", [])
    if PLUGIN not in enabled:
        enabled.append(PLUGIN)
    if PLUGIN in config["plugins"].get("disabled", []):
        parser.error("The Favorite plugin is explicitly disabled")
    config.setdefault("display", {})["busy_input_mode"] = "queue"
    config["display"]["busy_text_mode"] = "queue"
    candidate = yaml.safe_dump(config, allow_unicode=True, sort_keys=False).encode()
    assert yaml.safe_load(candidate) == config
    preflight(settings)
    if args.check:
        print("PASS: candidate YAML; operating profile unchanged")
        return

    # Back up exact bytes privately, including the prior plugin implementation.
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup = home / "state" / "queue-install-backups" / stamp
    backup.mkdir(parents=True, mode=0o700)
    atomic_write(backup / "config.yaml", original)
    target = home / "plugins" / PLUGIN
    for name in FILES:
        if (target / name).exists():
            atomic_write(backup / name, (target / name).read_bytes())
    if path.read_bytes() != original:
        raise RuntimeError("Profile changed during preflight; no installation applied")
    target.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        atomic_write(target / name, (SOURCE / name).read_bytes())
    atomic_write(path, candidate)
    print(json.dumps({"installed": "1.4.0", "channels": settings["queue_channels"], "capacity": args.capacity, "backup": str(backup), "restart_required": True}))


if __name__ == "__main__":
    main()
