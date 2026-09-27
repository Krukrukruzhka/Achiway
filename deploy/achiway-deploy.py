#!/usr/bin/python3 -I
"""Root-owned deployment entrypoint; accepts only two Achiway image digests."""

import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from urllib.request import urlopen


ROOT = Path('/opt/achiway')
MAINTENANCE = ROOT / 'maintenance'
DIGEST = r'sha256:[a-f0-9]{64}'


def deploy(command: str) -> None:
    match = re.fullmatch(rf'deploy ({DIGEST}) ({DIGEST})', command)
    if match is None:
        raise ValueError('Only deploy <backend digest> <frontend digest> is allowed')
    candidate = dict(zip(('backend', 'frontend'), match.groups()))
    if os.geteuid() != 0:
        raise PermissionError('This entrypoint must be installed and run by root')
    os.umask(0o077)
    os.chdir(ROOT)
    with (ROOT / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        update(candidate)


def update(candidate: dict[str, str]) -> None:
    # Do not inherit SSH-controlled Docker/Compose/Python configuration.
    environment = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'HTTP_PORT': '18080'}

    def select_images(images: dict[str, str]) -> None:
        for service in ('backend', 'frontend'):
            if re.fullmatch(DIGEST, images[service]) is None:
                raise ValueError('Invalid saved image digest')
            environment[f'{service.upper()}_IMAGE'] = (
                f'ghcr.io/krukrukruzhka/achiway-{service}@{images[service]}'
            )

    def compose(*arguments: str, **kwargs) -> subprocess.CompletedProcess:
        return subprocess.run(
            ['/usr/bin/docker', 'compose', '--project-name', 'achiway',
             '--env-file', str(ROOT / 'secrets.env'), '-f', str(ROOT / 'compose.yaml'),
             *arguments], env=environment, check=True, **kwargs,
        )

    def revision() -> str:
        def query(sql: str) -> str:
            return compose('exec', '-T', 'db', 'psql', '-U', 'achiway', '-d', 'achiway',
                           '-v', 'ON_ERROR_STOP=1', '-Atc', sql,
                           capture_output=True, text=True).stdout.strip()
        if not query("SELECT to_regclass('public.alembic_version')"):
            return ''
        return query('SELECT version_num FROM alembic_version ORDER BY version_num')

    def ready() -> None:
        with urlopen('http://127.0.0.1:18080/api/health/ready', timeout=10) as response:
            if response.status != 200 or json.load(response).get('status') != 'ok':
                raise RuntimeError('Application readiness check failed')

    def save(name: str, value: dict[str, str]) -> None:
        temporary = ROOT / f'{name}.tmp'
        temporary.write_text(json.dumps(value) + '\n')
        temporary.replace(ROOT / name)

    current = ROOT / 'current.json'
    previous = json.loads(current.read_text()) if current.exists() else None
    if MAINTENANCE.exists():
        raise RuntimeError('Maintenance is already active; administrator recovery is required')
    select_images(candidate)
    # Downloads and database readiness happen before interrupting the application.
    compose('pull', 'backend', 'frontend', timeout=300)
    compose('up', '-d', '--wait', '--wait-timeout', '90', 'db', timeout=180)
    before = revision()
    backups = ROOT / 'backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = backups / f'{stamp}.dump'
    pending_backup = backups / f'{stamp}.partial'
    migration_started = False
    migration_finished = False
    MAINTENANCE.touch(mode=0o644)
    # umask is deliberately restrictive for secrets; nginx must be able to stat this file.
    try:
        compose('stop', 'frontend', 'backend', timeout=90)
        with pending_backup.open('xb') as output:
            compose('exec', '-T', 'db', 'pg_dump', '-U', 'achiway', '-d', 'achiway', '-Fc',
                    stdout=output, timeout=180)
        with pending_backup.open('rb') as source:
            compose('exec', '-T', 'db', 'pg_restore', '--list',
                    stdin=source, stdout=subprocess.DEVNULL, timeout=30)
        pending_backup.replace(backup)
        save(f'backups/{stamp}.json', {'schema': before, **(previous or {})})
        migration_started = True
        compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'upgrade', 'head', timeout=180)
        migration_finished = True
        compose('run', '--rm', '--no-deps', 'backend', 'alembic', 'check', timeout=60)
        compose('up', '-d', '--wait', '--wait-timeout', '90', 'backend', 'frontend', timeout=150)
        ready()
        if previous:
            save('previous.json', previous)
        save('current.json', candidate)
        MAINTENANCE.unlink()
    except Exception:
        pending_backup.unlink(missing_ok=True)
        print('Deployment failed. Checking whether application rollback is safe.', flush=True)
        try:
            safe = not migration_started or (migration_finished and revision() == before)
            if previous and safe:
                select_images(previous)
                compose('stop', 'frontend', 'backend', timeout=90)
                compose('up', '-d', '--wait', '--wait-timeout', '90', 'backend', 'frontend', timeout=150)
                ready()
                MAINTENANCE.unlink()
                print('Previous application restored; database was not restored or downgraded.', flush=True)
            else:
                print('Maintenance remains enabled. An administrator must inspect the migration and backup.', flush=True)
        except Exception as rollback_error:
            print(f'Rollback failed; maintenance remains enabled: {rollback_error}', flush=True)
        raise
    print('Deployment healthy. Current images: ' + json.dumps(candidate), flush=True)
    for old in sorted(backups.glob('*.dump'))[:-7]:
        old.unlink()
        old.with_suffix('.json').unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one restricted SSH command')
        deploy(sys.argv[1])
    except Exception as error:
        print(f'Deployment error: {error}', file=sys.stderr)
        sys.exit(1)
